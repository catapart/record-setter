export class DataRecord {
    id = "";
}
export class RecordStore {
    #database;
    #storeName;
    #tables;
    #useSoftDelete = false;
    #softDeleteTimestampPropertyName = "deletedTimestamp";
    constructor(database, storeName, tables, options) {
        this.#database = database;
        this.#storeName = storeName;
        this.#tables = tables;
        if (options != null) {
            this.#useSoftDelete = options.useSoftDelete || this.#useSoftDelete;
            this.#softDeleteTimestampPropertyName = options.softDeleteTimestampPropertyName || this.#softDeleteTimestampPropertyName;
        }
    }
    openTransaction(transactionMode = 'readwrite') {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        return this.#database.transaction(this.#tables, transactionMode);
    }
    async addRecord(record) {
        await this.updateRecord(record);
        return true;
    }
    async addRecords(records) {
        return (await this.updateRecords(records)).map(item => item != null);
    }
    getRecord(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.openTransaction('readonly');
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.get(id);
            request.onsuccess = (event) => {
                const value = event.target.result;
                resolve(value);
            };
            request.onerror = (event) => { reject(event); };
        });
    }
    async getRecords(ids, sortKey) {
        const transaction = this.openTransaction('readonly');
        const promises = [];
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            promises.push(new Promise((resolve, reject) => {
                const objectStore = transaction.objectStore(this.#storeName);
                const request = objectStore.get(id);
                request.onsuccess = (event) => {
                    const value = event.target.result;
                    resolve(value);
                };
                request.onerror = (event) => { reject(event); };
            }));
        }
        let records = await Promise.all(promises);
        if (sortKey != null) {
            /* @ts-expect-error Provided sort key may not be able to index into record */
            records = records.sort((a, b) => { return a[sortKey] - b[sortKey]; });
        }
        return records;
    }
    async getAllRecords(sortKey) {
        return new Promise((resolve, reject) => {
            const transaction = this.openTransaction('readonly');
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.getAll();
            request.onsuccess = (event) => {
                let value = event.target.result;
                if (sortKey != null) {
                    /* @ts-expect-error Provided sort key may not be able to index into record */
                    value = value.sort((a, b) => { return a[sortKey] - b[sortKey]; });
                }
                resolve(value);
            };
            request.onerror = (event) => { reject(event); };
        });
    }
    async query(equalityPredicate, sortKey) {
        return new Promise((resolve, reject) => {
            const transaction = this.openTransaction('readonly');
            const objectStore = transaction.objectStore(this.#storeName);
            const predicateKeys = Object.keys(equalityPredicate);
            const predicateValues = Object.values(equalityPredicate);
            const hasMultiplePredicates = predicateKeys.length > 1;
            let cursorParent = null;
            if (hasMultiplePredicates) {
                try {
                    const indexKey = predicateKeys.join('+');
                    cursorParent = objectStore.index(indexKey);
                }
                catch (_) { /* error does not need additional handling */ }
            }
            const hasCombinedPredicate = cursorParent != null;
            if (cursorParent == null) {
                const predicateKey = predicateKeys[0];
                cursorParent = (predicateKey == 'id') ? objectStore : objectStore.index(predicateKey);
            }
            const predicateValue = (predicateValues == null) ? null : (hasCombinedPredicate) ? predicateValues : predicateValues[0];
            let request;
            let skipFirstPredicate = false;
            if (!hasCombinedPredicate && Array.isArray(predicateValue)) {
                request = cursorParent.openCursor();
            }
            else {
                skipFirstPredicate = true;
                request = cursorParent.openCursor(IDBKeyRange.only(predicateValue));
            }
            const results = [];
            request.onsuccess = (event) => {
                const currentCursor = event.target.result;
                if (currentCursor == null) {
                    let values = results;
                    if (sortKey != null) {
                        /* @ts-expect-error Provided sort key may not be able to index into record */
                        values = results.toSorted((a, b) => a[sortKey] - b[sortKey]);
                    }
                    resolve(values);
                    return;
                }
                // check if predicate fails on any of the values
                // skip the first value, if a cursor was opened using it
                let foundDifference = false;
                for (let i = (skipFirstPredicate == true) ? 1 : 0; i < predicateKeys.length; i++) {
                    /* @ts-expect-error Provided prediate key may not be able to index into record */
                    const cursorValue = currentCursor.value[predicateKeys[i]];
                    const currentPredicateValues = predicateValues[i];
                    if (Array.isArray(currentPredicateValues)) {
                        let foundMatch = false;
                        for (let j = 0; j < currentPredicateValues.length; j++) {
                            const matchValue = currentPredicateValues[j];
                            if (cursorValue == matchValue) {
                                foundMatch = true;
                            }
                        }
                        if (foundMatch == false) {
                            foundDifference = true;
                            break;
                        }
                    }
                    /* @ts-expect-error Provided prediate key may not be able to index into record */
                    else if (currentCursor.value[predicateKeys[i]] != currentPredicateValues) {
                        foundDifference = true;
                        break;
                    }
                }
                if (!foundDifference) {
                    results.push(currentCursor.value);
                }
                currentCursor.continue();
            };
            request.onerror = (event) => { reject(event); };
        });
    }
    updateRecord(record) {
        return new Promise((resolve, reject) => {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.put(record);
            request.onsuccess = async (event) => {
                const updatedRecordId = event.target.result;
                const getRequest = objectStore.get(updatedRecordId);
                getRequest.onerror = (event) => { reject(event); };
                getRequest.onsuccess = (event) => {
                    const updatedRecord = event.target.result;
                    resolve(updatedRecord);
                };
            };
            request.onerror = (event) => { reject(event); };
        });
    }
    async updateRecords(records) {
        const transaction = this.openTransaction();
        const promises = [];
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            promises.push(new Promise((resolve, reject) => {
                const objectStore = transaction.objectStore(this.#storeName);
                const request = objectStore.put(record);
                request.onsuccess = (event) => {
                    const value = event.target.result;
                    resolve(value);
                };
                request.onerror = (event) => { reject(event); };
            }));
        }
        const results = await Promise.all(promises);
        const updatedRecords = await this.getRecords(results);
        return updatedRecords;
    }
    removeRecord(id, overrideSoftDelete = false) {
        if (!overrideSoftDelete && this.#useSoftDelete) {
            return this.setIsDeletedSingle(id, true);
        }
        return new Promise((resolve, reject) => {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.delete(id);
            request.onsuccess = (event) => {
                const value = event.target.result;
                resolve(value);
            };
            request.onerror = (event) => { reject(event); };
        });
    }
    removeRecords(ids, overrideSoftDelete = false) {
        if (!overrideSoftDelete && this.#useSoftDelete) {
            return this.setIsDeletedMultiple(ids, true);
        }
        return new Promise((resolve, reject) => {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            // deleting multiple records in indexedDB is weird;
            // they prefer you do it one at a time, so that's
            // what has been abstracted here.
            const results = [];
            const removeRecord = (index) => {
                if (index > ids.length - 1) {
                    resolve(results);
                    return;
                }
                const request = objectStore.delete(ids[index]);
                request.onsuccess = () => {
                    results.push(true);
                    removeRecord(index + 1);
                };
            };
            removeRecord(0);
            transaction.onabort = function (event) { console.log("Transaction Aborted"); reject(event); };
            transaction.oncomplete = function (event) {
                // console.log('Transaction Completed');
                const value = event.target.result;
                resolve(value);
            };
        });
    }
    restoreRecord = (id) => this.setIsDeletedSingle(id, false);
    restoreRecords = (ids) => this.setIsDeletedMultiple(ids, false);
    async setIsDeletedSingle(id, value) {
        const target = await this.getRecord(id);
        target[this.#softDeleteTimestampPropertyName] = (value == true) ? Date.now() : undefined;
        await this.updateRecord(target);
        return true;
    }
    async setIsDeletedMultiple(ids, value) {
        const targets = await this.getRecords(ids);
        for (let i = 0; i < targets.length; i++) {
            targets[i][this.#softDeleteTimestampPropertyName] = (value == true) ? Date.now() : undefined;
        }
        await this.updateRecords(targets);
        return new Array().fill(true, 0, targets.length - 1);
    }
    clear() {
        return new Promise((resolve, reject) => {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.clear();
            request.onsuccess = (event) => {
                const value = event.target.result;
                resolve(value);
            };
            request.onerror = (event) => { reject(event); };
        });
    }
}
export class RecordSetter {
    #isOpen = false;
    #isInitialized = false;
    #database;
    #keyValueTableName = "keyValue";
    stores = new Map();
    async open(options) {
        await this.openDatabase(options);
        return this.#isOpen && this.#isInitialized;
    }
    async openDatabase(options) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(options.name, options.version);
            request.onsuccess = (event) => {
                const dbEvent = event.target;
                this.#database = dbEvent.result;
                this.#isOpen = true;
                this.#isInitialized = true;
                resolve();
            };
            request.onupgradeneeded = async (event) => {
                const dbEvent = event.target;
                this.#database = dbEvent.result;
                await this.createDatabase(options);
                this.#isInitialized = true;
                this.#isOpen = true;
                resolve();
            };
            request.onerror = (event) => { reject(event); };
        });
    }
    async createDatabase(options) {
        // called after upgradeneeded finished; no need to initialize;
        if (this.#isInitialized == true) {
            return;
        }
        const storePromises = [];
        for (const [tableName, columnsKey] of Object.entries(options.schema)) {
            const indexesArray = columnsKey.split(',').map(item => item.trim());
            storePromises.push(this.createStorePromise(tableName, indexesArray));
        }
        if (Object.keys(options.schema).indexOf(options.keyValueTableName) == -1) {
            storePromises.push(new Promise((resolve, reject) => {
                this.#keyValueTableName = options.keyValueTableName ?? this.#keyValueTableName;
                const objectStore = this.#database.createObjectStore(this.#keyValueTableName, { keyPath: "key" });
                objectStore.transaction.oncomplete = (_event) => {
                    resolve();
                };
                objectStore.transaction.onerror = (event) => {
                    reject(event);
                };
            }));
        }
        return Promise.all(storePromises);
    }
    async createStorePromise(tableName, indexesArray) {
        const indexDefinitionsArray = new Array();
        for (let j = 0; j < indexesArray.length; j++) {
            const key = indexesArray[j];
            let name = key;
            let keyPath = key;
            let unique = false;
            if (key.startsWith('!')) {
                name = key.substring(1);
                unique = true;
            }
            else if (key.startsWith('[') && key.endsWith(']')) {
                name = key.substring(1, key.length - 1);
                const compositeArray = name.split('+');
                keyPath = compositeArray;
                // console.log('composite', compositeArray);
            }
            indexDefinitionsArray.push({ name, keyPath, unique });
        }
        // console.log(tableName, indexDefinitionsArray);
        const indexPromises = [];
        const objectStore = this.#database.createObjectStore(tableName, { keyPath: indexDefinitionsArray[0].keyPath });
        for (let i = 1; i < indexDefinitionsArray.length; i++) {
            indexPromises.push(new Promise((resolve, reject) => {
                const columnDefinition = indexDefinitionsArray[i];
                objectStore.createIndex(columnDefinition.name, columnDefinition.keyPath, { unique: columnDefinition.unique, multiEntry: (!Array.isArray(columnDefinition.keyPath)) });
                if (Array.isArray(columnDefinition.keyPath)) {
                    for (let j = 0; j < columnDefinition.keyPath.length; j++) {
                        const isUnique = columnDefinition.keyPath[j].startsWith('!') ? true : false;
                        const pathName = isUnique ? columnDefinition.keyPath[j].substring(1) : columnDefinition.keyPath[j];
                        objectStore.createIndex(pathName, pathName, { unique: isUnique, multiEntry: true });
                    }
                }
                objectStore.transaction.oncomplete = (_event) => {
                    resolve();
                };
                objectStore.transaction.onerror = (event) => {
                    reject(event);
                };
            }));
        }
        await Promise.all(indexPromises);
    }
    async close() {
        if (this.#database == null) {
            this.#isOpen = false;
            return !this.#isOpen;
        }
        this.#database.close();
        this.#isOpen = false;
        return !this.#isOpen;
    }
    async delete() {
        if (this.#isOpen) {
            await this.close();
        }
        return this.deleteDatabase();
    }
    deleteDatabase() {
        return new Promise((resolve) => {
            if (this.#database == null || this.#isInitialized != true) {
                throw new Error("Unable to delete an uninitialized database.");
            }
            const deleteRequest = indexedDB.deleteDatabase(this.#database.name);
            deleteRequest.onsuccess = () => {
                this.#database = undefined;
                this.#isInitialized = false;
                resolve(true);
            };
            deleteRequest.onerror = (error) => {
                console.error(error);
                resolve(false);
            };
        });
    }
    addStore(storeName, tables, options) {
        if (this.stores.get(storeName) != null) {
            throw new Error("Cannot add store with same name as existing store.");
        }
        this.stores.set(storeName, new RecordStore(this.#database, storeName, tables ?? [storeName], options));
        return this.stores.get(storeName);
    }
    getStore(name) {
        const store = this.stores.get(name);
        if (store == null) {
            throw new Error(`Store could not be found by name: ${name}`);
        }
        return store;
    }
    async getKeyValueStore() {
        let store = this.stores.get(this.#keyValueTableName);
        if (store == null) {
            store = await this.addStore(this.#keyValueTableName);
        }
        if (store == null) {
            throw new Error('Unable to create a key-value store.');
        }
        return store;
    }
    async getValue(key) {
        return this.getData(this.#keyValueTableName, key);
    }
    async getValues(keys) {
        return this.getDataValues(this.#keyValueTableName, keys);
    }
    async getAllValues() {
        return this.getAllData(this.#keyValueTableName);
    }
    async setValue(key, value) {
        return this.setData(this.#keyValueTableName, key, value);
    }
    async setValues(items) {
        return this.setDataValues(this.#keyValueTableName, items);
    }
    // data sets direct values, based on keys
    // instead of storing a managed object 
    // type (records). This allows for simple
    // key-value storage alongside record storage;
    // getting and setting data is limited to
    // directly handling data in a single table;
    async getAllData(storeName) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event) => { throw event; };
        const value = await new Promise((resolve, reject) => {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.getAll();
            request.onsuccess = (event) => {
                const record = event.target.result;
                const result = record == null ? [] : record.value;
                resolve(result);
            };
            request.onerror = (event) => { reject(event); };
        });
        return value;
    }
    async getData(storeName, key) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event) => { throw event; };
        const value = await new Promise((resolve, reject) => {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.get(key);
            request.onsuccess = (event) => {
                const record = event.target.result;
                const result = record == null ? null : record.value;
                resolve(result);
            };
            request.onerror = (event) => { reject(event); };
        });
        return value;
    }
    async getDataValues(storeName, ids) {
        const transaction = this.openTransaction([storeName], 'readonly');
        const promises = [];
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            promises.push(new Promise((resolve, reject) => {
                const objectStore = transaction.objectStore(storeName);
                const request = objectStore.get(id);
                request.onsuccess = (event) => {
                    const record = event.target.result;
                    resolve(record == null ? null : record.value);
                };
                request.onerror = (event) => { reject(event); };
            }));
        }
        const records = await Promise.all(promises);
        return records;
    }
    async setData(storeName, key, value) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event) => { throw event; };
        const result = await new Promise((resolve, reject) => {
            const objectStore = transaction.objectStore(storeName);
            const request = (value == undefined) ? objectStore.delete(key) : objectStore.put({ key, value });
            request.onsuccess = (event) => {
                const value = event.target.result;
                resolve(value);
            };
            request.onerror = (event) => { reject(event); };
        });
        return result;
    }
    async setDataValues(storeName, values) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event) => { throw event; };
        const objectStore = transaction.objectStore(storeName);
        const promises = [];
        for (let i = 0; i < values.length; i++) {
            const value = values[i];
            promises.push(new Promise((innerResolve, innerReject) => {
                const request = (value.value == undefined) ? objectStore.delete(value.key) : objectStore.put(value);
                request.onsuccess = (event) => {
                    const value = event.target.result;
                    innerResolve(value);
                };
                request.onerror = (event) => { innerReject(event); };
            }));
        }
        await Promise.all(promises);
    }
    async removeData(storeName, ...keys) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event) => { throw event; };
        return await new Promise((resolve, _reject) => {
            const objectStore = transaction.objectStore(storeName);
            const promises = [];
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                promises.push(new Promise((innerResolve, innerReject) => {
                    const request = objectStore.delete(key);
                    request.onsuccess = (event) => {
                        const value = event.target.result;
                        innerResolve(value);
                    };
                    request.onerror = (event) => { innerReject(event); };
                }));
            }
            resolve(Promise.all(promises));
        });
    }
    async getKeys(storeName, ...keys) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event) => { throw event; };
        const value = await new Promise((resolve, reject) => {
            const objectStore = transaction.objectStore(storeName);
            const request = (keys.length == 0) ? objectStore.getAll() : objectStore.get(keys);
            request.onsuccess = (event) => {
                const record = event.target.result;
                resolve((record == null) ? [] : record.map((item) => { return item.key; }));
            };
            request.onerror = (event) => { reject(event); };
        });
        return value;
    }
    async setKey(storeName, key) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event) => { throw event; };
        const result = await new Promise((resolve, reject) => {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.put({ key });
            request.onsuccess = (event) => {
                const value = event.target.result;
                resolve(value);
            };
            request.onerror = (event) => { reject(event); };
        });
        return result;
    }
    async setKeys(storeName, keys) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName]);
        const promises = [];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            promises.push(new Promise((resolve, reject) => {
                const objectStore = transaction.objectStore(storeName);
                const request = objectStore.put({ key });
                request.onsuccess = (event) => {
                    const value = event.target.result;
                    resolve(value);
                };
                request.onerror = (event) => { reject(event); };
            }));
        }
        const results = await Promise.all(promises);
        const updatedRecords = await this.getKeys(storeName, ...results);
        return updatedRecords;
    }
    async removeKey(storeName, key) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event) => { throw event; };
        return new Promise((resolve, reject) => {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.delete(key);
            request.onsuccess = (event) => {
                const value = event.target.result;
                resolve(value);
            };
            request.onerror = (event) => { reject(event); };
        });
    }
    async clearStoreKeys(storeName) {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event) => { throw event; };
        return new Promise((resolve, reject) => {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.clear();
            request.onsuccess = (event) => {
                const value = event.target.result;
                resolve(value);
            };
            request.onerror = (event) => { reject(event); };
        });
    }
    openTransaction(tables, transactionMode = 'readwrite') {
        if (this.#database == null) {
            throw new Error("The database has not been opened.");
        }
        return this.#database.transaction(tables, transactionMode);
    }
    static generateId() {
        const rnd = new Uint8Array(20);
        crypto.getRandomValues(rnd);
        const b64 = [].slice
            .apply(rnd)
            .map(function (ch) {
            return String.fromCharCode(ch);
        })
            .join('');
        const secret = btoa(b64)
            .replace(/\//g, '_')
            .replace(/\+/g, '-')
            .replace(/=/g, '');
        return secret;
    }
}
