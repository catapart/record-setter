/** Object that includes an `id` property */
export class RecordBase
{
    /** a key to identify this record */ 
    id: string = "";
}
/** Interface that includes a `deletedTimestamp` property */
export interface IRestorableRecord
{
    /**
     * The `Date.now()` value at the time this record was deleted
     */
    deletedTimestamp?: number;
}
/** Object that includes an `id` property and a `deletedTimestamp` property */
export class DataRecord extends RecordBase implements IRestorableRecord
{ 
    deletedTimestamp?: number;
}
/** Allowed types for Record properties */
export type RecordProperty = string|number|boolean|Blob;

/** Options for a `RecordStore` instance */
export interface RecordStoreOptions
{
    /** When calling `removeItem` or `removeItems`, if this option is `true`, this store will set those records' `deletedTimestamp`
    * property (or configured property) to the time the method was called, rather than removing the item from the store.  
    * If this option is `false`, the record will be immediately removed from the store. */
    useSoftDelete?:boolean;
    /** The name of the property to set the timestamp to, when `removeItem` or `removeItems` is called on this store. */
    softDeleteTimestampPropertyName?: string;
}
/** Manages `Record`-type objects of a single type, `T`, in the target `IDBDatabase` connection. */
export class RecordStore<T extends RecordBase = RecordBase>
{
    #database: IDBDatabase;

    #storeName: string;
    #tables: string[];
    
    #useSoftDelete: boolean = false;
    #softDeleteTimestampPropertyName: string = "deletedTimestamp";

    /**
     * Manages `Record`-type objects of a single type, `T`, in the target `IDBDatabase` connection.
     * @example new RecordStore<ParentRecord>(database, 'parents', ['parents', 'children', 'grandchildren'], { useSoftDelete: true }); 
     * @template T an object that extends `RecordBase`, to be managed by the store.
     * @param database and open `IDBDatabase` connection
     * @param storeName the name to reference this store by
     * @param tables the names of all tables that this store will share transactions with.  
     * Transactions are shared in `Promise` scopes, so most `async`/`await` calls that will
     * unite record data from different tables require shared scopes.
     * @param options target `RecordStoreOptions` values
     */
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

    /**
     * Open a transaction in the database for handling this store's `Record`s
     * @param transactionMode "readonly" | "readwrite" | "versionchange"
     * @returns IDBTransaction
     */
    openTransaction(transactionMode: IDBTransactionMode = 'readwrite')
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        return this.#database.transaction(this.#tables, transactionMode);
    }

    /**
     * Add a record to the database
     * @template T the store's `Record` type
     * @param record the record to add
     * @returns `boolean` to indicate a successful add
     */
    async addRecord(record: T): Promise<boolean>
    {
        await this.updateRecord(record);
        return true;
    }
    /**
     * Add multiple records to the database
     * @template T the store's `Record` type
     * @param records the records to add
     * @returns `boolean[]` to indicate a successful adds, by index
     */
    async addRecords(records: T[]): Promise<boolean[]>
    {
        return (await this.updateRecords(records)).map(item => item != null);
    }

    /**
     * Get a record from the database, by its id
     * @template T the store's `Record` type
     * @param id the id of the record to retrieve
     * @returns the `Record` or `null`
     */
    getRecord(id: string):  Promise<T | null>
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction('readonly');
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.get(id);
            request.onsuccess = (event: Event) =>
            {
                const value = (event.target as unknown as { result: T|null }).result;
                resolve(value);
            }
            request.onerror = (event: Event) => { reject(event); }
        });

    }
    /**
     * Get records from the database, by their ids
     * @template T the store's `Record` type
     * @param ids the ids of the records to retrieve
     * @param sortKey a property of the records to use as key for sorting them by
     * @returns an array of the requested `Record`s
     */
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
                request.onsuccess = (event: Event) =>
                {
                    const value: T = (event.target as unknown as { result: T }).result;
                    resolve(value);
                }
                request.onerror = (event: Event) => { reject(event); }
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
    /**
     * Get all records of this store's type
     * @template T the store's `Record` type
     * @param sortKey a property of the records to use as key for sorting them by
     * @returns an array of all `Record`s that this store manages.
     */
    async getAllRecords(sortKey?: string): Promise<T[]>
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction('readonly')
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.getAll();
            request.onsuccess = (event: Event) =>
            {
                let value: T[] = (event.target as unknown as { result: T[] }).result;
                if(sortKey != null)
                {
                    /* @ts-expect-error Provided sort key may not be able to index into record */
                    value = value.sort((a, b) => { return a[sortKey] - b[sortKey]; });
                }
                resolve(value);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
    }
    /**
     * Find all `Record`s of this store's type that match the equality predicate
     * @example store.query({ name: 'User Name' }, 'name');
     * @template T the store's `Record` type
     * @param equalityPredicate an object with properties that match the names of properties  
     to match on the `Record`s managed by this store, and values  
     that match the values of `Record`s being requested.  
     ***Query properties must be indexed to be able to be queried.**
     * @param sortKey a property of the records to use as key for sorting them by
     * @returns an array of the `Record`s that match the equality predicate
     */
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
            request.onsuccess = (event: Event) =>
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
            request.onerror = (event: Event) => { reject(event); }
        });

    }

    /**
    * Update the values of a `Record` managed by this store
    * @template T the store's `Record` type
    * @param record the updated `Record` to store in the database
    * @returns the updated `Record` from the database
    */
    updateRecord(record: T):  Promise<T>
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.put(record);
            request.onsuccess = async (event: Event) =>
            {
                const updatedRecordId = (event.target as unknown as { result: string }).result;
                const getRequest = objectStore.get(updatedRecordId);
                getRequest.onerror = (event: Event) => { reject(event); }
                getRequest.onsuccess = (event: Event) =>
                {
                    const updatedRecord = (event.target as unknown as { result: T }).result;
                    resolve(updatedRecord);
                }
            }
            request.onerror = (event: Event) => { reject(event); }
        });
    }
    /**
    * Update the values of a `Record` managed by this store
    * @template T the store's `Record` type
    * @param records the updated `Record`s to store in the database
    * @returns the updated `Record`s from the database
    */
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
                request.onsuccess = (event: Event) =>
                {
                    const value = (event.target as unknown as { result: string }).result;
                    resolve(value);
                }
                request.onerror = (event: Event) => { reject(event); }
            }));
        }

        const results: string[] = await Promise.all(promises);
        const updatedRecords = await this.getRecords(results)
        return updatedRecords;
    }

    /**
    * Remove a `Record` managed by this store.  
    * If this store has been configured to "soft delete" records, this function will set the 
    * configured `deletedTimestamp` property to the runtime value of `Date.now()`
    * @param id the id of the `Record` to remove
    * @param overrideSoftDelete force this function to remove the record from the store, rather than allowing it to set the `deletedTimestamp` property 
    * @returns a `boolean` to indicate success
    */
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
            request.onsuccess = (event: Event) =>
            {
                const value = (event.target as unknown as { result: boolean }).result;
                resolve(value);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
    }
    /**
    * Remove `Record`s managed by this store.  
    * If this store has been configured to "soft delete" records, this function will set the 
    * configured `deletedTimestamp` properties to the runtime value of `Date.now()`
     * @param ids the id of the `Record`s to remove
     * @param overrideSoftDelete force this function to remove the records from the store, rather than allowing it to set their `deletedTimestamp` properties 
     * @returns an array of `boolean` values to indicate success
     */
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

            transaction.onabort = function(event: Event) { console.log("Transaction Aborted"); reject(event); };
            transaction.oncomplete = function(event: Event) 
            { 
                // console.log('Transaction Completed');
                const value = (event.target as unknown as { result: boolean[] }).result;
                resolve(value);
            };
        });
    }

    /**
     * Restore a 'Record` that has been removed using the "soft delete" method.
     * @param id the id of the `Record` to restore
     * @returns a `boolean` to indicate success
     */
    restoreRecord = (id: string) => this.setIsDeletedSingle(id, false);
    /**
     * Restore 'Record`s that have been removed using the "soft delete" method.
     * @param ids the ids of the `Record`s to restore
     * @returns an array of `boolean` values to indicate success
     */
    restoreRecords = (ids: string[]) => this.setIsDeletedMultiple(ids, false);

    /**
     * Set the `deletedTimestamp` property of an `IRestorable` record.
     * @param id the id of the `Record` to update
     * @param value determines whether to set or delete the property. To set the property, this value should be `true`. To delete the property, this value should be `false`.
     * @returns a `boolean` to indicate success
     */
    async setIsDeletedSingle(id: string, value: boolean)
    {
        const target = await this.getRecord(id);
        (target as unknown as any)[this.#softDeleteTimestampPropertyName] = (value == true) ? Date.now() : undefined;
        await this.updateRecord(target as T);
        return true;
    }
    /**
     * Set the `deletedTimestamp` properties of multpile `IRestorable` records to the same value.
     * @param ids the ids of the `Record`s to update
     * @param value determines whether to set or delete the property. To set the property, this value should be `true`. To delete the property, this value should be `false`.
     * @returns an array of `boolean` values to indicate success
     */
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

    /**
     * Remove all records managed by this store
     * @returns a `boolean` to indicate success
     */
    clear()
    {
        return new Promise((resolve, reject) =>
        {
            const transaction = this.openTransaction();
            const objectStore = transaction.objectStore(this.#storeName);
            const request = objectStore.clear();
            request.onsuccess = (event: Event) =>
            {
                const value = (event.target as unknown as { result: boolean }).result;
                resolve(value);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
    }

    
}

/** A definition for an object that acts as key/value pairs to define a table schema.  
*The key indicates the table name.  
*The value indicates the indexes, separated by commas.
* @example { "users": "id, name", "profiles": "id, userId", "posts": "id, [userId+postType]", [...] }
*/
export type RecordSetterSchema = { [key: string]: string; };
/** Options for a `RecordSetter` instance */
export interface RecordSetterOptions
{
    name: string;
    version: number;
    schema: RecordSetterSchema;
    keyValueTableName?: string;
}

/** An asynchronous indexedDB wrapper that includes record management, query functions, and batch operations  */
export class RecordSetter
{
    #isOpen: boolean = false;
    #isInitialized: boolean = false;

    #database?: IDBDatabase;

    #keyValueTableName: string = "keyValue";

    /** A map of the `RecordStore`s managed by this `RecordSetter` instance */
    stores: Map<string, RecordStore<RecordBase>> = new Map();

    //#region Database - Create, open, update, delete database

    /**
     * Create and then await and validate opening a `RecordSetter` instance
     * @param options target `RecordSetterOptions` values
     * @returns a validated `RecordSetter` instance
     */
    static async activate(options: RecordSetterOptions)
    {
        const instance = new RecordSetter();
        const opened = await instance.open(options);
        if(opened == false) { throw new Error("An error occurred opening the database."); }
        return instance;
    }
    /**
     * Open the `RecordSetter` instance's database and initialize its functionality
     * @param options target `RecordSetterOptions` values
     * @returns a `boolean` to indicate success
     */
    async open(options: RecordSetterOptions):Promise<boolean>
    {
        await this.#openDatabase(options);

        return this.#isOpen && this.#isInitialized;
    }
    /**
     * Opens an instance of an `IDBDatabase` database, and registers for upgrade events.  
     * Listens for `onupgradeneeded` to create an `IDBDatabase` instance if it does not exist, and upgrade the instance if it does.
     * @param options target `RecordSetterOptions` values
     * @returns an awaitable `Promise`
     */
    async #openDatabase(options: RecordSetterOptions)
    {
        return new Promise<void>((resolve, reject) =>
        {                
            const request = indexedDB.open(options.name, options.version);
            request.onsuccess = (event: Event) =>
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
                await this.#createDatabase(options);
                this.#isInitialized = true;
                this.#isOpen = true;
                resolve();
            };

            request.onerror = (event: Event) => { reject(event); }

        });
    }
    /**
     * Create the database instance's object stores
     * @param options target `RecordSetterOptions` values
     * @returns an awaitable `Promise`
     */
    async #createDatabase(options: RecordSetterOptions)
    {
        // called after upgradeneeded finished; no need to initialize;
        if(this.#isInitialized == true) { return; }

        const storePromises: Promise<void>[] = [];
        for(const [tableName, columnsKey] of Object.entries(options.schema))
        {
            const indexesArray = columnsKey.split(',').map(item => item.trim());
            storePromises.push(this.#createStorePromise(tableName, indexesArray));
        }

        if(Object.keys(options.schema).indexOf(options.keyValueTableName!) == -1)
        {
            storePromises.push(new Promise((resolve, reject) =>
            {
                this.#keyValueTableName = options.keyValueTableName ?? this.#keyValueTableName;
                const objectStore = this.#database!.createObjectStore(this.#keyValueTableName, { keyPath: "key" });
                objectStore.transaction.oncomplete = (_event: Event) =>
                {
                    resolve();
                }
                objectStore.transaction.onerror = (event: Event) =>
                {
                    reject(event);
                }
            }))
        }

        return Promise.all(storePromises);
    }
    /**
     * Establishes a store and its indexes
     * @param name the name of the `IDBObjectStore` to create
     * @param indexesArray the indexes to add to this `IDBObjectStore`
     */
    async #createStorePromise(name: string, indexesArray: string[])
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
        const objectStore = this.#database!.createObjectStore(name, {keyPath: indexDefinitionsArray[0].keyPath });
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
                objectStore.transaction.oncomplete = (_event: Event) =>
                {
                    resolve();
                }
                objectStore.transaction.onerror = (event: Event) =>
                {
                    reject(event);
                }
            }));
        }

        await Promise.all(indexPromises);
    }

    /**
     * Close the database connection and desconstruct the instance
     * @returns a `boolean` to indicate success
     */
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
    /**
     * Closes the current database instance, if it is open, and then deletes the database.
     * @returns a `boolean` to indicate success
     */
    async delete(): Promise<boolean>
    {        
        if(this.#isOpen)
        {
            await this.close();
        }

        return this.#deleteDatabase();
    }
    /**
     * Deletes the database.
     * @returns a `boolean` to indicate success
     */
    #deleteDatabase()
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
            deleteRequest.onerror = (error: unknown) =>
            {
                console.error(error);
                resolve(false);
            };
        });
    }
    
    /**
     * Open new transaction in the managed database
     * @param tables the tables to include in this transaction scope
     * @param transactionMode the `IDBTransactionMode` the transaction will operate in
     * @returns a new transaction on the managed database in the target mode
     */
    openTransaction(tables: string[], transactionMode: IDBTransactionMode = 'readwrite')
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        return this.#database.transaction(tables, transactionMode);
    }

    //#endregion

    //#region Stores - Manage Records

    /**
     * Add a store to be managed by this `RecordSetter` instance
     * @param storeName the name of the store to add
     * @param tables the names of all tables that this store will share transactions with.  
     * Transactions are shared in `Promise` scopes, so most `async`/`await` calls that will
     * unite record data from different tables require shared scopes.
     * @param options `RecordStoreOptions` values for the new `RecordStore` instance
     * @returns a new `RecordStore` instance
     */
    addStore<T extends RecordBase = RecordBase, R extends RecordStore<T> = RecordStore<T>>(storeName: string, tables?: string[], options?: RecordStoreOptions)
    {
        if(this.stores.get(storeName) != null) { throw new Error("Cannot add store with same name as existing store."); }

        this.stores.set(storeName, new RecordStore<T>(this.#database!, storeName, tables ?? [storeName], options));
        return this.stores.get(storeName) as R;
    }

    /**
     * Get a `RecordStore` that is managed by this instance.
     * @template T extends `RecordBase`
     * @param name the name of the store to get
     * @returns a `RecordStore` instance that manages `Record`s of type `T`.
     */
    getStore<T extends RecordBase = RecordBase, R extends RecordStore<T> = RecordStore<T>>(name: string)
    {
        const store = this.stores.get(name);
        if(store == null)
        {
            throw new Error(`Store could not be found by name: ${name}`);
        }
        return store as R;
    }
    /**
     * Get a default `RecordStore` instance that manages key/value pairs in the database
     * @returns the KeyValue `RecordStore` instance
     */
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

    //#endregion
    
    

    //#region Data - Key/Value management

    /**
     * Get a value from the Key/Value `RecordStore`
     * @param key the key to match
     * @returns the value associated with the target key
     */
    async getValue<T extends string|number|boolean|Blob|null|undefined = undefined>(key: string): Promise<T|null>
    {
        return this.getData(this.#keyValueTableName, key);
    }
    /**
     * Get values from the Key/Value `RecordStore`
     * @param keys the keys to match
     * @returns the values associated with the target keys
     */
    async getValues<T extends string|number|boolean|Blob|null|undefined = undefined>(keys: string[]): Promise<(T|null)[]>
    {
        return this.getDataValues(this.#keyValueTableName, keys);
    }
    /**
     * Get all values from the Key/Value `RecordStore`
     * @returns an array of the values
     */
    async getAllValues<T extends string|number|boolean|Blob|null|undefined = undefined>(): Promise<(T|null)[]>
    {
        return this.getAllData<T>(this.#keyValueTableName);
    }
    /**
     * Set a value in the Key/Value `RecordStore`
     * @param key the key to assign a value to
     * @param value the value to assign to the target key
     */
    async setValue<T extends string|number|boolean|Blob|null|undefined>(key: string, value: T)
    {
        await this.setData(this.#keyValueTableName, key, value);
    }
    /**
     * Set values in the Key/Value `RecordStore`
     * @param items an array of key/value pairs defining the data to set
     */
    async setValues<T extends string|number|boolean|Blob|null|undefined>(items: {key: string, value: T }[])
    {
        await this.setDataValues(this.#keyValueTableName, items);
    }

    // data sets direct values, based on keys
    // instead of storing a managed object 
    // type (records). This allows for simple
    // key-value storage alongside record storage;
    // getting and setting data is limited to
    // directly handling data in a single table;

    /**
     * Get all data stored in the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to collect data from
     * @returns an array of all values stored in the target `IDBObjectStore`
     */
    async getAllData<T extends string|number|boolean|Blob|null|undefined = undefined>(storeName: string): Promise<(T|null)[]>
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event: Event) => { throw event; }
        const value = await new Promise<(T|null)[]>((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.getAll();
            request.onsuccess = (event: Event) =>
            {
                const record = (event.target as unknown as { result: { value: T[] } }).result;
                const result = record == null ? [] : record.value;
                resolve(result);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
        return value;
    }
    /**
     * Get the value of an entry in the target `IDBObjectStore`, by key
     * @param storeName the name of the `IDBObjectStore` to get the value from
     * @param key the key to match 
     * @returns the value assigned to the matching key, or null
     */
    async getData<T extends string|number|boolean|Blob|null|undefined = undefined>(storeName: string, key: string): Promise<T|null>
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event: Event) => { throw event; }
        const value = await new Promise<T|null>((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.get(key);
            request.onsuccess = (event: Event) =>
            {
                const record = (event.target as unknown as { result: { value: T } }).result;
                const result = record == null ? null : record.value;
                resolve(result);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
        return value;
    }
    /**
     * Get the values of the entries in the target `IDBObjectStore`, by keys
     * @param storeName the name of the `IDBObjectStore` to get the values from
     * @param keys the keys to match 
     * @returns an array of the values assigned to the matching keys, or null
     */
    async getDataValues<T extends string|number|boolean|Blob|null|undefined = undefined>(storeName: string, keys: string[]):  Promise<(T|null)[]>
    {
        const transaction = this.openTransaction([storeName], 'readonly');
        const promises: Promise<T|null>[] = [];
        for(let i = 0; i < keys.length; i++)
        {
            const id = keys[i];
            promises.push(new Promise<T|null>((resolve, reject) =>
            {
                const objectStore = transaction.objectStore(storeName);
                const request = objectStore.get(id);
                request.onsuccess = (event: Event) =>
                {
                    const record = (event.target as unknown as { result: { value: T } }).result;
                    resolve(record == null ? null : record.value);
                }
                request.onerror = (event: Event) => { reject(event); }
            }));
        }

        const records = await Promise.all(promises);
        return records;
    }
    /**
     * Set the value of an entry in the target `IDBObjectStore`, by key
     * @param storeName the name of the `IDBObjectStore` to set the values in
     * @param key the key to match 
     * @param value the value to assign to the matching key
     */
    async setData<T extends string|number|boolean|Blob|null|undefined = undefined>(storeName: string, key: string|number, value: string|number|boolean|Blob|null|undefined)
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        
        await new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = (value == undefined) ? objectStore.delete(key) : objectStore.put({key, value});
            request.onsuccess = (event: Event) =>
            {
                const value = (event.target as unknown as { result: T }).result;
                resolve(value);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
    }
    /**
     * Set the values of an entries in the target `IDBObjectStore`, by keys
     * @param storeName the name of the `IDBObjectStore` to set the values in
     * @param values an array of key/value pairs defining the data to set
     */
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
                request.onsuccess = (event: Event) =>
                {
                    const value = (event.target as unknown as { result: unknown }).result;
                    innerResolve(value);
                }
                request.onerror = (event: Event) => { innerReject(event); }
            }));
        }

        await Promise.all(promises);
    }
    /**
     * Remove an entries from the target `IDBObjectStore`, by key
     * @param storeName the name of the `IDBObjectStore` to remove the values from
     * @param keys the keys to match 
     */
    async removeData(storeName: string, ...keys: (string|number)[])
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        await new Promise((resolve, _reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const promises: Promise<unknown>[] = [];
            for(let i = 0; i < keys.length; i++)
            {
                const key = keys[i];
                promises.push(new Promise((innerResolve, innerReject) =>
                {
                    const request = objectStore.delete(key);
                    request.onsuccess = (event: Event) =>
                    {
                        const value = (event.target as unknown as { result: unknown }).result;
                        innerResolve(value);
                    }
                    request.onerror = (event: Event) => { innerReject(event); }
                }));

            }

            resolve(Promise.all(promises));
        });
    }

    //#endregion

    //#region Key-Only Management - data like tags, which are just strings, can be stored without even a value. Only a key is necessary

    /**
     * Query the target `IDBObjectStore` for the target keys, and return all that exist.
     * @param storeName the name of the `IDBObjectStore` to query
     * @param keys the keys to match 
     * @returns the matching keys that exist in the `IDBObjectStore`
     */
    async getKeys(storeName: string, ...keys:string[])
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName], 'readonly');
        transaction.onerror = (event: Event) => { throw event; }
        const value = await new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = (keys.length == 0) ? objectStore.getAll() : objectStore.get(keys);
            request.onsuccess = (event: Event) =>
            {
                const record = (event.target as unknown as { result: { key: string }[] }).result;
                resolve((record == null) ? [] : record.map((item: {key: string}) => { return item.key }));
            }
            request.onerror = (event: Event) => { reject(event); }
        });
        return value as string[];
    }
    /**
     * Store a key, without an associated value, in the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to store the key in
     * @param key the value to store
     * @returns the value that was stored
     */
    async setKey(storeName:string, key: string)
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        
        const result = await new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.put({key});
            request.onsuccess = (event: Event) =>
            {
                const value = (event.target as unknown as { result: unknown }).result;
                resolve(value);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
        return result;
    }
    /**
     * Store keys, without associated values, in the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to store the keys in
     * @param keys the values to store
     * @returns an array of the stored keys
     */
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
                request.onsuccess = (event: Event) =>
                {
                    const value = (event.target as unknown as { result: string }).result;
                    resolve(value);
                }
                request.onerror = (event: Event) => { reject(event); }
            }));
        }

        const results: string[] = await Promise.all(promises);
        const updatedRecords = await this.getKeys(storeName, ...results)
        return updatedRecords;
    }
    /**
     * Removes a key from the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to remove the key from
     * @param key the key to remove
     */
    async removeKey(storeName: string, key: string)
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        await new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.delete(key);
            request.onsuccess = (event: Event) =>
            {
                const value = (event.target as unknown as { result: unknown }).result;
                resolve(value);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
    }
    /**
     * Remove all keys from the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to remove the keys from
     */
    async clearStoreKeys(storeName: string)
    {
        if(this.#database == null) { throw new Error("The database has not been opened."); }
        const transaction = this.openTransaction([storeName]);
        transaction.onerror = (event: Event) => { throw event; }
        await new Promise((resolve, reject) =>
        {
            const objectStore = transaction.objectStore(storeName);
            const request = objectStore.clear();
            request.onsuccess = (event: Event) =>
            {
                const value = (event.target as unknown as { result: unknown }).result;
                resolve(value);
            }
            request.onerror = (event: Event) => { reject(event); }
        });
    }

    //#endregion
    
    /**
     * Create a random, locally-unique string value to use as an id
     * @returns a `string` id value
     */
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