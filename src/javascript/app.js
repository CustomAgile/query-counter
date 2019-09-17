
Ext.define('TSQueryCounter', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    items: [{
        xtype: 'container',
        layout: {
            type: 'vbox',
            align: 'stretch'
        },
        items: [{
            xtype: 'container',
            layout: {
                type: 'hbox',
                align: 'middle'
            },
            items: [
                {
                    id: Utils.AncestorPiAppFilter.RENDER_AREA_ID,
                    xtype: 'container',
                    layout: {
                        type: 'hbox',
                        align: 'middle',
                        defaultMargins: '0 10 10 0',
                    }
                },
                {
                    xtype: 'rallybutton',
                    style: { float: 'right' },
                    cls: 'secondary rly-small',
                    frame: false,
                    width: 34,
                    itemId: 'export-menu-button',
                    iconCls: 'icon-export'
                }
            ]
        }, {
            id: Utils.AncestorPiAppFilter.PANEL_RENDER_AREA_ID,
            xtype: 'container',
            layout: {
                type: 'hbox',
                align: 'middle',
                defaultMargins: '0 10 10 0',
            }
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
        Rally.data.wsapi.Proxy.superclass.timeout = 120000;
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
            filtersHidden: false,
            listeners: {
                scope: this,
                ready(plugin) {
                    plugin.addListener({
                        scope: this,
                        select: this._runApp,
                        change: this._runApp
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
    async _runApp() {
        let me = this;
        let promisesComplete = 0;
        let promises = [];
        let ancestorFilters = {};
        me.errorCount = 0;
        me.maxErrors = 5;
        me.loadingFailed = false;

        this.setLoading('Loading Filters...');

        const refreshMask = () => {
            this.setLoading(`Counting  ${promisesComplete} complete of ${promises.length} error count ${me.errorCount}`);
        };
        const displayError = () => {
            me.errorCount++;
            refreshMask();
        };
        let timeboxScope = this.getContext().getTimeboxScope();
        let countVariables = this._getCountVariables();

        this.logger.log('_runApp', countVariables);

        for (let cv of countVariables) {
            let { artifactType } = cv;
            let { query } = cv;
            let { id } = cv;

            let filters = null;
            let ancestorFiltersForType = [];

            if (timeboxScope && this._timeboxScopeIsValidForArtifactType(timeboxScope, artifactType)) {
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

            if (ancestorFilters[artifactType]) {
                ancestorFiltersForType = ancestorFilters[artifactType];
            } else {
                ancestorFiltersForType = await this.ancestorFilterPlugin.getAllFiltersForType(artifactType, true).catch((e) => {
                    this._showErrorNotification(e.message || e);
                    this.setLoading(false);
                    this.loadingFailed = true;
                });
                if (ancestorFiltersForType) {
                    ancestorFilters[artifactType] = ancestorFiltersForType;
                }
            }

            if (this.loadingFailed) {
                return;
            }

            if (ancestorFiltersForType) {
                for (let i = 0; i < ancestorFiltersForType.length; i++) {
                    if (filters) {
                        filters = filters.and(ancestorFiltersForType[i]);
                    } else {
                        filters = ancestorFiltersForType[i];
                    }
                }
            }

            let promise = this._loadRecordCount(artifactType, filters || [], id, displayError);
            promise.then((a) => {
                if (!this.loadingFailed) {
                    promisesComplete++;
                    refreshMask();
                    return a;
                }
            }).catch((e) => {
                throw new Error(e);
            });
            promises.push(promise);
        }

        if (promises.length > 0) {
            refreshMask();

            Promise.all(promises)
                .then((...args) => this._updateDisplay(...args))
                .catch((...args) => {
                    // Other promises could continue to resolve and update display so
                    // we set a flag to prevent this from happening
                    this.loadingFailed = true;
                    this._showErrorNotification(...args);
                })
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
            fetch: ['_ref'],
            enablePostGet: true
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
                    if (me.errorCount < me.maxErrors) {
                        this._loadRecordCount(model, filters, id, onFailedAttempt)
                            .then((p) => deferred.resolve(p))
                            .catch((e) => { deferred.reject(e); });
                    }
                    else {
                        deferred.reject(this._parseException(operation, `Store failed to load for type ${model}. Filter result set may have been too large`));
                    }
                }
            },
            scope: this
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
    },

    _parseException(e, defaultMessage) {
        if (typeof e === 'string') {
            return e;
        }
        if (e.exception && e.error && e.error.errors && e.error.errors.length && e.error.errors[0]) {
            return e.error.errors[0];
        }
        if (e.exceptions && e.exceptions.length && e.exceptions[0].error) {
            if (typeof e.exceptions[0].error === 'string') {
                return e.exceptions[0].error;
            }
            // eslint-disable-next-line no-else-return
            else if (e.exceptions[0].error.statusText) {
                return e.exceptions[0].error.statusText;
            }
        }
        console.log('Unable to parse exception', e);
        return defaultMessage;
    }

});
