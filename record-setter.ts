export class DataRecord
{ 
    id: string = "";
}
export type RecordProperty = string|number|boolean|Blob;

export interface RecordStoreOptions
{
    useSoftDelete?:boolean;
    softDeleteTimestampPropertyName?: string;
}
export class RecordStore<T extends DataRecord = DataRecord>
{
    #database: IDBDatabase;

    #storeName: string;
    #tables: string[];
    
    #useSoftDelete: boolean = false;
    #softDeleteTimestampPropertyName: string = "deletedTimestamp";

    constructor(database: IDBDatabase, storeName: string, tables: string[], options?: RecordStoreOptions)
    {
        this.#database = database;
        this.#storeName = storeName;
        this.#tables = tables;

        if(options != null)
        {
            this.#useSoftDelete = options.useSoftDelete || this.#useSoftDelete;
            this.#softDeleteTimestampPropertyName = options.softDeleteTimestampPropertyName || this.#softDeleteTimestampPropertyName;
        }
    }

    openTransaction(transactionMode: IDBTransactionMode = 'readwrite')
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        return this.#database.transaction(this.#tables, transactionMode);
    }

    async addRecord(record: T): Promise<boolean>
    {
        await this.updateRecord(record);
        return true;
    }
    async addRecords(records: T[]): Promise<boolean[]>
    {
        return (await this.updateRecords(records)).map(item => item != null);
    }

    getRecord(id: string):  Promise<T | null>
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction('readonly');
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.get(id);
            request.onsuccess = (event) =>
            {
                const value = (event.target as unknown as { result: T|null }).result;
                resolve(value);
            }
            request.onerror = (event) => { reject(event); }
        });

    }
    async getRecords(ids: string[], sortKey?: string):  Promise<T[]>
    {
        const transaction = this.openTransaction('readonly');
        const promises = [];
        for(let i = 0; i < ids.length; i++)
        {
            const id = ids[i];
            promises.push(new Promise<T>((resolve, reject) =>
            {
                const objectStore = transaction.objectStore(this.#storeName);
                const request = objectStore.get(id);
                request.onsuccess = (event) =>
                {
                    const value: T = (event.target as unknown as { result: T }).result;
                    resolve(value);
                }
                request.onerror = (event) => { reject(event); }
            }));
        }

        let records: T[] = await Promise.all(promises);
        if(sortKey != null)
        {
            /* @ts-expect-error Provided sort key may not be able to index into record */
            records = records.sort((a, b) => { return a[sortKey] - b[sortKey]; });
        }
        return records;
    }
    async getAllRecords(sortKey?: string): Promise<T[]>
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction('readonly')
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.getAll();
            request.onsuccess = (event) =>
            {
                let value: T[] = (event.target as unknown as { result: T[] }).result;
                if(sortKey != null)
                {
                    /* @ts-expect-error Provided sort key may not be able to index into record */
                    value = value.sort((a, b) => { return a[sortKey] - b[sortKey]; });
                }
                resolve(value);
            }
            request.onerror = (event) => { reject(event); }
        });
    }
    async query(equalityPredicate: { [key: string]: unknown; }, sortKey?: string | undefined):Promise<T[]>
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction('readonly');
            const objectStore = transaction.objectStore(this.#storeName);

            const predicateKeys = Object.keys(equalityPredicate);
            const predicateValues = Object.values(equalityPredicate);

            const hasMultiplePredicates = predicateKeys.length > 1;

            
            let cursorParent = null;
            if(hasMultiplePredicates)
            {
                try
                {
                    const indexKey = predicateKeys.join('+');
                    cursorParent = objectStore.index(indexKey);
                }
                catch(_){ /* error does not need additional handling */ }
            }

            const hasCombinedPredicate = cursorParent != null;
            
            if(cursorParent == null)
            {
                const predicateKey = predicateKeys[0];
                cursorParent =(predicateKey == 'id') ? objectStore : objectStore.index(predicateKey);
            }

            const predicateValue = (predicateValues == null) ? null : (hasCombinedPredicate) ? predicateValues : predicateValues[0];

            let request;
            let skipFirstPredicate = false;
            if(!hasCombinedPredicate && Array.isArray(predicateValue))
            {
                request = cursorParent.openCursor();
            }
            else
            {
                skipFirstPredicate = true;
                request = cursorParent.openCursor(IDBKeyRange.only(predicateValue));
            }

            const results: T[] = [];
            request.onsuccess = (event) =>
            {
                const currentCursor = (event.target as unknown as { result: { value: T, continue: () => void } }).result;
                
                if(currentCursor == null) 
                { 
                    let values = results;
                    if(sortKey != null)
                    {
                        /* @ts-expect-error Provided sort key may not be able to index into record */
                        values = results.toSorted((a, b) => a[sortKey] - b[sortKey]); 
                    }
                    resolve(values);
                    return; 
                }

                // check if predicate fails on any of the values
                // skip the first value, if a cursor was opened using it
                let foundDifference = false;
                for(let i = (skipFirstPredicate == true) ? 1 : 0; i < predicateKeys.length; i++)
                {
                    /* @ts-expect-error Provided prediate key may not be able to index into record */
                    const cursorValue = currentCursor.value[predicateKeys[i]];
                    const currentPredicateValues = predicateValues[i];
                    if(Array.isArray(currentPredicateValues))
                    {
                        let foundMatch = false;
                        for(let j = 0; j < currentPredicateValues.length; j++)
                        {
                            const matchValue = currentPredicateValues[j];
                            if(cursorValue == matchValue)
                            {
                                foundMatch = true;
                            }
                        }

                        if(foundMatch == false)
                        {
                            foundDifference = true;
                            break;
                        }
                    }
                    /* @ts-expect-error Provided prediate key may not be able to index into record */
                    else if(currentCursor.value[predicateKeys[i]] != currentPredicateValues)
                    {
                        foundDifference = true;
                        break;
                    }
                }
                
                if(!foundDifference) { results.push(currentCursor.value); }

                currentCursor.continue();
            }
            request.onerror = (event) => { reject(event); }
        });

    }

    updateRecord(record: T):  Promise<T>
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.put(record);
            request.onsuccess = async (event) =>
            {
                const updatedRecordId = (event.target as unknown as { result: string }).result;
                const getRequest = objectStore.get(updatedRecordId);
                getRequest.onerror = (event) => { reject(event); }
                getRequest.onsuccess = (event) =>
                {
                    const updatedRecord = (event.target as unknown as { result: T }).result;
                    resolve(updatedRecord);
                }
            }
            request.onerror = (event) => { reject(event); }
        });
    }
    async updateRecords(records: T[]):  Promise<T[]>
    {
        const transaction = this.openTransaction();
        const promises = [];
        for(let i = 0; i < records.length; i++)
        {
            const record = records[i];
            promises.push(new Promise<string>((resolve, reject) =>
            {
                const objectStore = transaction.objectStore(this.#storeName);
                const request = objectStore.put(record);
                request.onsuccess = (event) =>
                {
                    const value = (event.target as unknown as { result: string }).result;
                    resolve(value);
                }
                request.onerror = (event) => { reject(event); }
            }));
        }

        const results: string[] = await Promise.all(promises);
        const updatedRecords = await this.getRecords(results)
        return updatedRecords;
    }

    removeRecord(id: string, overrideSoftDelete: boolean = false):  Promise<boolean>
    {
        if(!overrideSoftDelete && this.#useSoftDelete)
        {
            return this.setIsDeletedSingle(id, true);
        }
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.delete(id);
            request.onsuccess = (event) =>
            {
                const value = (event.target as unknown as { result: boolean }).result;
                resolve(value);
            }
            request.onerror = (event) => { reject(event); }
        });
    }
    removeRecords(ids: string[], overrideSoftDelete: boolean = false):  Promise<boolean[]>
    {
        if(!overrideSoftDelete && this.#useSoftDelete)
        {
            return this.setIsDeletedMultiple(ids, true);
        }
        
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            
            // deleting multiple records in indexedDB is weird;
            // they prefer you do it one at a time, so that's
            // what has been abstracted here.
            const results: boolean[] = [];
            const removeRecord = (index: number) =>
            {
                if(index > ids.length - 1)
                { 
                    resolve(results);
                    return;
                }
                const request = objectStore.delete(ids[index]);
                request.onsuccess = () =>
                {
                    results.push(true);
                    removeRecord(index + 1);
                }
            };
            removeRecord(0);

            transaction.onabort = function(event) { console.log("Transaction Aborted"); reject(event); };
            transaction.oncomplete = function(event) 
            { 
                // console.log('Transaction Completed');
                const value = (event.target as unknown as { result: boolean[] }).result;
                resolve(value);
            };
        });
    }

    restoreRecord = (id: string) => this.setIsDeletedSingle(id, false);
    restoreRecords = (ids: string[]) => this.setIsDeletedMultiple(ids, false);

    async setIsDeletedSingle(id: string, value: boolean)
    {
        const target = await this.getRecord(id);
        (target as unknown as any)[this.#softDeleteTimestampPropertyName] = (value == true) ? Date.now() : undefined;
        await this.updateRecord(target as T);
        return true;
    }
    async setIsDeletedMultiple(ids: string[], value: boolean)
    {
        const targets = await this.getRecords(ids);
        for(let i = 0; i < targets.length; i++)
        {
            (targets[i] as unknown as any)[this.#softDeleteTimestampPropertyName] = (value == true) ? Date.now() : undefined;
        }
        await this.updateRecords(targets as T[]);
        return new Array().fill(true, 0, targets.length - 1);
    }

    clear()
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.clear();
            request.onsuccess = (event) =>
            {
                const value = (event.target as unknown as { result: unknown }).result;
                resolve(value);
            }
            request.onerror = (event) => { reject(event); }
        });
    }

    
}

export interface RecordSetterOptions
{
    name: string;
    version: number;
    schema: { [key: string]: string; };
    keyValueTableName?: string;
}

export class RecordSetter
{
    #isOpen: boolean = false;
    #isInitialized: boolean = false;

    #database?: IDBDatabase;

    #keyValueTableName: string = "keyValue";

    stores: Map<string, RecordStore<DataRecord>> = new Map();

    async open(options: RecordSetterOptions):Promise<boolean>
    {
        await this.openDatabase(options);

        return this.#isOpen && this.#isInitialized;
    }
    private async openDatabase(options: RecordSetterOptions)
    {
        return new Promise<void>((resolve, reject) =>
        {                
            const request = indexedDB.open(options.name, options.version);
            request.onsuccess = (event) =>
            {
                const dbEvent = event.target as unknown as { result: IDBDatabase|undefined };
                this.#database = dbEvent.result;

                this.#isOpen = true;
                this.#isInitialized = true;
                resolve();
            };

            request.onupgradeneeded = async (event: IDBVersionChangeEvent) =>
            {
                const dbEvent = event.target as unknown as { result: IDBDatabase|undefined };
                this.#database = dbEvent.result;
                await this.createDatabase(options);
                this.#isInitialized = true;
                this.#isOpen = true;
                resolve();
            };

            request.onerror = (event) => { reject(event); }

        });
    }
    private async createDatabase(options: RecordSetterOptions)
    {
        // called after upgradeneeded finished; no need to initialize;
        if(this.#isInitialized == true) { return; }

        const storePromises: Promise<void>[] = [];
        for(const [tableName, columnsKey] of Object.entries(options.schema))
        {
            const indexesArray = columnsKey.split(',').map(item => item.trim());
            storePromises.push(this.createStorePromise(tableName, indexesArray));
        }

        if(Object.keys(options.schema).indexOf(options.keyValueTableName!) == -1)
        {
            storePromises.push(new Promise((resolve, reject) =>
            {
                this.#keyValueTableName = options.keyValueTableName ?? this.#keyValueTableName;
                const objectStore = this.#database!.createObjectStore(this.#keyValueTableName, { keyPath: "key" });
                objectStore.transaction.oncomplete = (_event) =>
                {
                    resolve();
                }
                objectStore.transaction.onerror = (event) =>
                {
                    reject(event);
                }
            }))
        }

        return Promise.all(storePromises);
    }
    private async createStorePromise(tableName: string, indexesArray: string[])
    {
        const indexDefinitionsArray = new Array<{name: string, keyPath: string|string[], unique:boolean}>();
        for(let j = 0; j < indexesArray.length; j++)
        {
            const key = indexesArray[j];
            let name = key;
            let keyPath:string|string[] = key;
            let unique = false;
            if(key.startsWith('!'))
            {
                name = key.substring(1);
                unique = true;
            }
            else if(key.startsWith('[') && key.endsWith(']'))
            {
                name = key.substring(1, key.length -1);
                const compositeArray = name.split('+');
                keyPath = compositeArray;
                // console.log('composite', compositeArray);
            }
            indexDefinitionsArray.push({ name, keyPath, unique });
        }
        // console.log(tableName, indexDefinitionsArray);

        const indexPromises: Promise<void>[] = [];
        const objectStore = this.#database!.createObjectStore(tableName, {keyPath: indexDefinitionsArray[0].keyPath });
        for(let i = 1; i < indexDefinitionsArray.length; i++)
        {
            indexPromises.push(new Promise((resolve, reject) =>
            {
                const columnDefinition = indexDefinitionsArray[i];
                objectStore.createIndex(columnDefinition.name, columnDefinition.keyPath, { unique: columnDefinition.unique, multiEntry: (!Array.isArray(columnDefinition.keyPath)) });
                if(Array.isArray(columnDefinition.keyPath))
                {
                    for(let j = 0; j < columnDefinition.keyPath.length; j++)
                    {
                        const isUnique = columnDefinition.keyPath[j].startsWith('!') ? true : false;
                        const pathName = isUnique ? columnDefinition.keyPath[j].substring(1) : columnDefinition.keyPath[j];
                        objectStore.createIndex(pathName, pathName, {unique: isUnique, multiEntry: true });
                    }
                }
                objectStore.transaction.oncomplete = (_event) =>
                {
                    resolve();
                }
                objectStore.transaction.onerror = (event) =>
                {
                    reject(event);
                }
            }));
        }

        await Promise.all(indexPromises);
    }

    async close(): Promise<boolean>
    {
        if(this.#database == null) 
        { 
            this.#isOpen = false;
            return !this.#isOpen;
        }

        this.#database.close();

        this.#isOpen = false;
        return !this.#isOpen;
    }
    async delete(): Promise<boolean>
    {        
        if(this.#isOpen)
        {
            await this.close();
        }

        return this.deleteDatabase();
    }
    private deleteDatabase()
    {
        return new Promise<boolean>((resolve) =>
        {
            if(this.#database == null || this.#isInitialized != true) 
            { 
                throw new Error("Unable to delete an uninitialized database.");
            }
            const deleteRequest = indexedDB.deleteDatabase(this.#database!.name);
            deleteRequest.onsuccess = () =>
            {
                this.#database = undefined;
                this.#isInitialized = false;
                resolve(true);
            };
            deleteRequest.onerror = (error) =>
            {
                console.error(error);
                resolve(false);
            };
        });
    }

    addStore<T extends DataRecord = DataRecord, R extends RecordStore<T> = RecordStore<T>>(storeName: string, tables?: string[], options?: RecordStoreOptions)
    {
        if(this.stores.get(storeName) != null) { throw new Error("Cannot add store with same name as existing store."); }

        this.stores.set(storeName, new RecordStore<T>(this.#database!, storeName, tables ?? [storeName], options));
        return this.stores.get(storeName) as R;
    }

    getStore<T extends DataRecord = DataRecord, R extends RecordStore<T> = RecordStore<T>>(name: string)
    {
        const store = this.stores.get(name);
        if(store == null)
        {
            throw new Error(`Store could not be found by name: ${name}`);
        }
        return store as R;
    }
    async getKeyValueStore()
    {
        let store = this.stores.get(this.#keyValueTableName);
        if(store == null)
        {
            store = await this.addStore(this.#keyValueTableName);
        }
        if(store == null) { throw new Error('Unable to create a key-value store.'); }

        return store;
    }
    
    async getValue<T extends string|number|boolean|Blob|null|undefined = undefined>(key: string): Promise<T|null>
    {
        return this.getData(this.#keyValueTableName, key);
    }
    async getValues<T extends string|number|boolean|Blob|null|undefined = undefined>(keys: string[]): Promise<(T|null)[]>
    {
        return this.getDataValues(this.#keyValueTableName, keys);
    }
    async getAllValues<T extends string|number|boolean|Blob|null|undefined = undefined>(): Promise<(T|null)[]>
    {
        return this.getAllData<T>(this.#keyValueTableName);
    }
    async setValue<T extends string|number|boolean|Blob|null|undefined>(key: string, value: T)
    {
        return this.setData(this.#keyValueTableName, key, value);
    }
    async setValues<T extends string|number|boolean|Blob|null|undefined>(items: {key: string, value: T }[])
    {
        return this.setDataValues(this.#keyValueTableName, items);
    }

    // data sets direct values, based on keys
    // instead of storing a managed object 
    // type (records). This allows for simple
    // key-value storage alongside record storage;
    // getting and setting data is limited to
    // directly handling data in a single table;
    async getAllData<T extends string|number|boolean|Blob|null|undefined = undefined>(storeName: string): Promise<(T|null)[]>
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event: Event) => { throw event; }
        const value = await new Promise<(T|null)[]>((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.getAll();
            request.onsuccess = (event) =>
            {
                const record = (event.target as unknown as { result: { value: T[] } }).result;
                const result = record == null ? [] : record.value;
                resolve(result);
            }
            request.onerror = (event) => { reject(event); }
        });
        return value;
    }
    async getData<T extends string|number|boolean|Blob|null|undefined = undefined>(storeName: string, key: string): Promise<T|null>
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event: Event) => { throw event; }
        const value = await new Promise<T|null>((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.get(key);
            request.onsuccess = (event) =>
            {
                const record = (event.target as unknown as { result: { value: T } }).result;
                const result = record == null ? null : record.value;
                resolve(result);
            }
            request.onerror = (event) => { reject(event); }
        });
        return value;
    }
    async getDataValues<T extends string|number|boolean|Blob|null|undefined = undefined>(storeName: string, ids: string[]):  Promise<(T|null)[]>
    {
        const transaction = this.openTransaction([storeName], 'readonly');
        const promises: Promise<T|null>[] = [];
        for(let i = 0; i < ids.length; i++)
        {
            const id = ids[i];
            promises.push(new Promise<T|null>((resolve, reject) =>
            {
                const objectStore = transaction.objectStore(storeName);
                const request = objectStore.get(id);
                request.onsuccess = (event) =>
                {
                    const record = (event.target as unknown as { result: { value: T } }).result;
                    resolve(record == null ? null : record.value);
                }
                request.onerror = (event) => { reject(event); }
            }));
        }

        const records = await Promise.all(promises);
        return records;
    }
    async setData<T extends string|number|boolean|Blob|null|undefined = undefined>(storeName: string, key: string|number, value: string|number|boolean|Blob|null|undefined)
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        
        const result = await new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = (value == undefined) ? objectStore.delete(key) : objectStore.put({key, value});
            request.onsuccess = (event) =>
            {
                const value = (event.target as unknown as { result: T }).result;
                resolve(value);
            }
            request.onerror = (event) => { reject(event); }
        });
        return result;
    }
    async setDataValues(storeName: string, values:{key: string|number, value: string|number|boolean|Blob|null|undefined}[])
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        const objectStore = transaction.objectStore(storeName);
        const promises: Promise<unknown>[] = [];
        for(let i = 0; i < values.length; i++)
        {
            const value = values[i];
            promises.push(new Promise((innerResolve, innerReject) =>
            {
                const request = (value.value == undefined) ? objectStore.delete(value.key) : objectStore.put(value);
                request.onsuccess = (event) =>
                {
                    const value = (event.target as unknown as { result: unknown }).result;
                    innerResolve(value);
                }
                request.onerror = (event) => { innerReject(event); }
            }));
        }

        await Promise.all(promises);
    }
    async removeData(storeName: string, ...keys: (string|number)[])
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        return await new Promise((resolve, _reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const promises: Promise<unknown>[] = [];
            for(let i = 0; i < keys.length; i++)
            {
                const key = keys[i];
                promises.push(new Promise((innerResolve, innerReject) =>
                {
                    const request = objectStore.delete(key);
                    request.onsuccess = (event) =>
                    {
                        const value = (event.target as unknown as { result: unknown }).result;
                        innerResolve(value);
                    }
                    request.onerror = (event) => { innerReject(event); }
                }));

            }

            resolve(Promise.all(promises));
        });
    }

    async getKeys(storeName: string, ...keys:string[])
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event: Event) => { throw event; }
        const value = await new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = (keys.length == 0) ? objectStore.getAll() : objectStore.get(keys);
            request.onsuccess = (event) =>
            {
                const record = (event.target as unknown as { result: { key: string }[] }).result;
                resolve((record == null) ? [] : record.map((item: {key: string}) => { return item.key }));
            }
            request.onerror = (event) => { reject(event); }
        });
        return value as string[];
    }
    async setKey(storeName:string, key: string)
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        
        const result = await new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.put({key});
            request.onsuccess = (event) =>
            {
                const value = (event.target as unknown as { result: unknown }).result;
                resolve(value);
            }
            request.onerror = (event) => { reject(event); }
        });
        return result;
    }
    async setKeys(storeName:string, keys: string[]):  Promise<string[]>
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        const promises: Promise<string>[] = [];
        for(let i = 0; i < keys.length; i++)
        {
            const key = keys[i];
            promises.push(new Promise<string>((resolve, reject) =>
            {
                const objectStore = transaction.objectStore(storeName);
                const request = objectStore.put({key});
                request.onsuccess = (event) =>
                {
                    const value = (event.target as unknown as { result: string }).result;
                    resolve(value);
                }
                request.onerror = (event) => { reject(event); }
            }));
        }

        const results: string[] = await Promise.all(promises);
        const updatedRecords = await this.getKeys(storeName, ...results)
        return updatedRecords;
    }
    async removeKey(storeName: string, key: string)
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        return new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.delete(key);
            request.onsuccess = (event) =>
            {
                const value = (event.target as unknown as { result: unknown }).result;
                resolve(value);
            }
            request.onerror = (event) => { reject(event); }
        });
    }
    async clearStoreKeys(storeName: string)
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        return new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.clear();
            request.onsuccess = (event) =>
            {
                const value = (event.target as unknown as { result: unknown }).result;
                resolve(value);
            }
            request.onerror = (event) => { reject(event); }
        });
    }
    
    openTransaction(tables: string[], transactionMode: IDBTransactionMode = 'readwrite')
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        return this.#database.transaction(tables, transactionMode);
    }
    
    static generateId(): string
    {
        const rnd = new Uint8Array(20);
        crypto.getRandomValues(rnd);

        const b64 = [].slice
            .apply(rnd)
            .map(function (ch) 
            {
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