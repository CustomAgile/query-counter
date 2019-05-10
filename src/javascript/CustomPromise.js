// eslint-disable-next-line no-unused-vars
class CustomPromise {
    /**
     * @returns {Promise} the deft promise wrapped in ECMA6
     * @param {Ext.Deferred} deferred 
     */
    static async wrap(deferred) {
        if (
            !deferred ||
            !_.isFunction(deferred.then)
        ) {
            return Promise.reject(new Error('Wrap cannot process this type of data into a ECMA promise'));
        }
        return new Promise((resolve, reject) => {
            deferred.then({
                success(...args) {
                    resolve(...args);
                },
                failure(error) {
                    reject(error);
                    // Do something on failure.
                }
            }).always(() => {
                // Do something whether call succeeded or failed
            });
        });
    }
}

