import { DataRecord } from "./data-record";

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
        const promises: Promise<T>[] = [];
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

            
            let cursorParent: IDBIndex|IDBObjectStore|null = null;
            if(hasMultiplePredicates)
            {
                try
                {
                    const indexKey = predicateKeys.join('+');
                    // console.log('indexKey', indexKey);
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


            // let singlePredicateHasMultipleValues = false;
            
            // console.log(predicateKeys, predicateValues);

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
                    // console.log(results); 
                    return; 
                }

                // check if predicate fails on any of the values
                // skip the first value, if a cursor was opened using it
                let foundDifference = false;
                for(let i = (skipFirstPredicate == true) ? 1 : 0; i < predicateKeys.length; i++)
                {
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
        const promises: Promise<string>[] = [];
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