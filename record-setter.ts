import { DataRecord } from "./data-record";
import { RecordStore, RecordStoreOptions } from "./record-store";

export type RecordProperty = string|number|boolean|Blob;

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