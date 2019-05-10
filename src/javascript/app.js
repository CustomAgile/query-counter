
Ext.define('TSQueryCounter', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    // defaults: { margin: '0 0 10 0' },
    items: [{
        xtype: 'container',
        layout: {
            type: 'hbox',
            align: 'middle'
        },
        items: [{
            id: Utils.AncestorPiAppFilter.RENDER_AREA_ID,
            xtype: 'container',
            flex: 1,
            layout: {
                type: 'hbox',
                align: 'middle',
                defaultMargins: '0 10 10 0',
            }
        }, {
            xtype: 'rallybutton',
            style: { float: 'right' },
            cls: 'secondary rly-small',
            frame: false,
            itemId: 'export-menu-button',
            iconCls: 'icon-export'
        }]
    },
    {
        xtype: 'container',
        itemId: 'display_box'
    }
    ],

    config: {
        defaultSettings: {
            countVariables: [{
                artifactType: 'Defect',
                query: '( ObjectID > 0 )',
                id: 'defectCount'
            }, {
                artifactType: 'HierarchicalRequirement',
                query: '( ObjectID > 0 )',
                id: 'storyCount'
            }],
            html: 'Defects: {defectCount} or Stories: {storyCount}<br/><br/><em>Use the gear to make App Settings...</em>'
        }
    },

    currentValues: [],

    launch() {
        let exportButton = this.down('#export-menu-button');
        exportButton.on('click', this._onExport, this);
        this._validateSettings();

        this.ancestorFilterPlugin = Ext.create('Utils.AncestorPiAppFilter', {
            ptype: 'UtilsAncestorPiAppFilter',
            pluginId: 'ancestorFilterPlugin',
            settingsConfig: {
                labelWidth: 150,
                margin: 10
            },
            listeners: {
                scope: this,
                ready(plugin) {
                    plugin.addListener({
                        scope: this,
                        select() {
                            this._runApp();
                        }
                    });
                    this._reloadModel().then({
                        scope: this,
                        success: this._runApp
                    });
                },
            }
        });
        this.addPlugin(this.ancestorFilterPlugin);
    },

    _onExport() {
        let csv = ['Variable Name,Value'];
        _.each(this.currentValues, (value, key) => {
            csv.push([key, value].join(','));
        });
        csv = csv.join('\r\n');
        CArABU.technicalservices.FileUtilities.saveCSVToFile(csv, 'query-counter.csv');
    },

    _validateSettings() {
        let cv = this._getCountVariables();
        let html = this.getSetting('html');
        this.logger.log('setting ', this.getSettings());
        let errors = [];
        Ext.Array.each(cv, (c) => {
            let variableName = Ext.String.format('{{0}}', c.id);
            let re = new RegExp(variableName);

            if (!re.exec(html)) {
                errors.push(`Variable Name ${variableName} not used.`);
            }
        });
        if (errors.length > 0) {
            Rally.ui.notify.Notifier.showError({ message: errors.join('<br/>'), allowHTML: true });
        }
    },

    onTimeboxScopeChange(timebox) {
        this.callParent(arguments);
        this._runApp();
    },

    _timeboxScopeIsValidForArtifactType(timeboxScope, artifactType) {
        if (timeboxScope) {
            let model = this.models[artifactType];
            this.logger.log('_timeboxScopeIsValidForArtifactType', timeboxScope.getType(), model, model.getField('Milestones'), model.getField('Iteration'), model.getField('Release'), timeboxScope.getQueryFilter().toString());
            let field = 'Release';
            // eslint-disable-next-line default-case
            switch (timeboxScope.getType()) {
                case 'iteration':
                    field = 'Iteration';
                    break;
                case 'milestone':
                    field = 'Milestones';
                    break;
            }

            if (model.getField(field)) {
                this.logger.log('TimeboxScope', timeboxScope.getType(), 'is valid for', artifactType);
                return true;
            }
            this.logger.log('TimeboxScope', timeboxScope.getType(), 'NOT valid for', artifactType);

            return false;
        }
        this.logger.log('No Timebox Scope');
        return true;
    },

    _getCountVariables() {
        let cv = this.getSetting('countVariables');
        if (Ext.isString(cv)) {
            cv = JSON.parse(cv);
        }
        return cv;
    },

    _getModelNames() {
        let countVariables = this._getCountVariables();
        this.logger.log('countVariables ', countVariables);
        let modelNames = Ext.Array.map(countVariables, v => v.artifactType);
        return _.uniq(modelNames);
    },

    _reloadModel() {
        let deferred = Ext.create('Deft.Deferred');
        if (Ext.isEmpty(this._getModelNames())) {
            deferred.resolve();
        }
        // Load the model so that we can test if it is valid for the timebox scope
        Rally.data.ModelFactory.getModels({
            types: this._getModelNames(),
            scope: this,
            success(models) {
                this.logger.log('models ', models);
                this.models = models;
                deferred.resolve();
            }
        });
        return deferred.promise;
    },

    // There is a subtle  bug on timebox
    // scoped pages where the milestone timebox is not correctly restored after a settings change.
    // 1. Set page as milestone timebox scoped
    // 2. Pick a non-null milestone timebox
    // 3. Open app settings and save (no change needed)
    // 4. Timebox will be 'milestone' in the window.location.href instead of 'milestone/12345'.
    // See getSdkInfo() in the SDK for how the timebox is restored.
    // This only seems to occur the first time after the page is made timebox scoped and goes away once
    // the page is reloaded once.
    _runApp() {
        let promisesComplete = 0;
        let errorCount = 0;
        let promises = [];

        const refreshMask = () => {
            this.setLoading(`Counting  ${promisesComplete} complete of ${promises.length} error count ${errorCount}`);
        };
        const displayError = () => {
            errorCount++;
            refreshMask();
        };
        let timeboxScope = this.getContext().getTimeboxScope();
        let countVariables = this._getCountVariables();

        this.logger.log('_runApp', countVariables);

        Ext.Array.each(countVariables, function f(cv) {
            let { artifactType } = cv;
            let { query } = cv;
            let { id } = cv;

            let filters = null;

            if (timeboxScope && this._timeboxScopeIsValidForArtifactType(timeboxScope, artifactType)) {
                //               me.onTimeboxScopeChange(timebox);
                filters = timeboxScope.getQueryFilter();
                this.logger.log('Using Timebox Scope >>', filters.toString(), filters);
            }

            if (!Ext.isEmpty(query)) {
                if (filters) {
                    filters = filters.and(Rally.data.wsapi.Filter.fromQueryString(query));
                } else {
                    filters = Rally.data.wsapi.Filter.fromQueryString(query);
                }
            }

            let ancestorFilter = this.ancestorFilterPlugin.getFilterForType(artifactType);
            if (ancestorFilter) {
                filters = filters.and(ancestorFilter);
            }
            let promise = this._loadRecordCount(artifactType, filters || [], id, displayError);
            promise.then((a) => {
                promisesComplete++;
                refreshMask();
                return a;
            });
            promises.push(promise);
        }, this);

        if (promises.length > 0) {
            refreshMask();

            Promise.all(promises)
                .then((...args) => this._updateDisplay(...args))
                .catch((...args) => this._showErrorNotification(...args))
                .finally(() => this.setLoading(false));
        } else {
            this._updateDisplay();
        }
    },

    _showErrorNotification(msg) {
        this.logger.log('_showErrorNotification', msg);
        Rally.ui.notify.Notifier.showError({ message: msg });
    },

    async _loadRecordCount(model, filters, id, onFailedAttempt = () => { }) {
        let deferred = Ext.create('Deft.Deferred');
        let me = this;
        this.logger.log('Starting load: model >>', model, 'filters>>', filters.toString());
        let config = {
            model,
            filters,
            limit: 1,
            pageSize: 1,
            fetch: false
        };
        if (this.searchAllProjects()) {
            config.context = {
                project: null
            };
        }

        Ext.create('Rally.data.wsapi.Store', config).load({
            callback: (records, operation, successful) => {
                let result = {};
                if (successful) {
                    me.logger.log('result:', operation);
                    result[id] = operation.resultSet.totalRecords || 0;
                    deferred.resolve(result);
                } else {
                    console.warn('Failed: ', operation);
                    onFailedAttempt(id);
                    this._loadRecordCount(model, filters, id, onFailedAttempt)
                        .then(p => deferred.resolve(p));
                }
            }
        });
        return CustomPromise.wrap(deferred.promise);
    },

    _updateDisplay(values) {
        if (!values) { values = []; }

        values = _.reduce(values, (obj, v) => {
            obj = _.extend(obj, v);
            return obj;
        }, {});

        this.currentValues = values;

        this.logger.log('_updateDisplay', values);

        let html = this.getSetting('html');
        let tpl = new Ext.XTemplate(html);
        let displayBox = this.down('#display_box');
        displayBox.removeAll();
        let view = displayBox.add({
            xtype: 'container',
            tpl,
            cls: 'default-counter'
        });
        view.update(values);
    },

    isExternal() {
        return typeof (this.getAppId()) === 'undefined';
    },

    isMilestoneScoped() {
        let result = false;

        let tbscope = this.getContext().getTimeboxScope();
        if (tbscope && tbscope.getType() === 'milestone') {
            result = true;
        }
        return result;
    },

    searchAllProjects() {
        return this.ancestorFilterPlugin.getIgnoreProjectScope();
    },

    getSettingsFields() {
        return Rally.technicalservices.querycounter.Settings.getFields({
            width: this.getWidth()
        });
    }

});
