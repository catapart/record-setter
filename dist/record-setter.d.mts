/** Object that includes an `id` property */
declare class RecordBase {
    /** a key to identify this record */
    id: string;
}
/** Interface that includes a `deletedTimestamp` property */
interface IRestorableRecord {
    /**
     * The `Date.now()` value at the time this record was deleted
     */
    deletedTimestamp?: number;
}
/** Object that includes an `id` property and a `deletedTimestamp` property */
declare class DataRecord extends RecordBase implements IRestorableRecord {
    deletedTimestamp?: number;
}
/** Allowed types for Record properties */
type RecordProperty = string | number | boolean | Blob;
/** Options for a `RecordStore` instance */
interface RecordStoreOptions {
    /** When calling `removeItem` or `removeItems`, if this option is `true`, this store will set those records' `deletedTimestamp`
    * property (or configured property) to the time the method was called, rather than removing the item from the store.
    * If this option is `false`, the record will be immediately removed from the store. */
    useSoftDelete?: boolean;
    /** The name of the property to set the timestamp to, when `removeItem` or `removeItems` is called on this store. */
    softDeleteTimestampPropertyName?: string;
}
/** Manages `Record`-type objects of a single type, `T`, in the target `IDBDatabase` connection. */
declare class RecordStore<T extends RecordBase = RecordBase> {
    #private;
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
    constructor(database: IDBDatabase, storeName: string, tables: string[], options?: RecordStoreOptions);
    /**
     * Open a transaction in the database for handling this store's `Record`s
     * @param transactionMode "readonly" | "readwrite" | "versionchange"
     * @returns IDBTransaction
     */
    openTransaction(transactionMode?: IDBTransactionMode): IDBTransaction;
    /**
     * Add a record to the database
     * @template T the store's `Record` type
     * @param record the record to add
     * @returns `boolean` to indicate a successful add
     */
    addRecord(record: T): Promise<boolean>;
    /**
     * Add multiple records to the database
     * @template T the store's `Record` type
     * @param records the records to add
     * @returns `boolean[]` to indicate a successful adds, by index
     */
    addRecords(records: T[]): Promise<boolean[]>;
    /**
     * Get a record from the database, by its id
     * @template T the store's `Record` type
     * @param id the id of the record to retrieve
     * @returns the `Record` or `null`
     */
    getRecord(id: string): Promise<T | null>;
    /**
     * Get records from the database, by their ids
     * @template T the store's `Record` type
     * @param ids the ids of the records to retrieve
     * @param sortKey a property of the records to use as key for sorting them by
     * @returns an array of the requested `Record`s
     */
    getRecords(ids: string[], sortKey?: string): Promise<T[]>;
    /**
     * Get all records of this store's type
     * @template T the store's `Record` type
     * @param sortKey a property of the records to use as key for sorting them by
     * @returns an array of all `Record`s that this store manages.
     */
    getAllRecords(sortKey?: string): Promise<T[]>;
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
    query(equalityPredicate: {
        [key: string]: unknown;
    }, sortKey?: string | undefined): Promise<T[]>;
    /**
    * Update the values of a `Record` managed by this store
    * @template T the store's `Record` type
    * @param record the updated `Record` to store in the database
    * @returns the updated `Record` from the database
    */
    updateRecord(record: T): Promise<T>;
    /**
    * Update the values of a `Record` managed by this store
    * @template T the store's `Record` type
    * @param records the updated `Record`s to store in the database
    * @returns the updated `Record`s from the database
    */
    updateRecords(records: T[]): Promise<T[]>;
    /**
    * Remove a `Record` managed by this store.
    * If this store has been configured to "soft delete" records, this function will set the
    * configured `deletedTimestamp` property to the runtime value of `Date.now()`
    * @param id the id of the `Record` to remove
    * @param overrideSoftDelete force this function to remove the record from the store, rather than allowing it to set the `deletedTimestamp` property
    * @returns a `boolean` to indicate success
    */
    removeRecord(id: string, overrideSoftDelete?: boolean): Promise<boolean>;
    /**
    * Remove `Record`s managed by this store.
    * If this store has been configured to "soft delete" records, this function will set the
    * configured `deletedTimestamp` properties to the runtime value of `Date.now()`
     * @param ids the id of the `Record`s to remove
     * @param overrideSoftDelete force this function to remove the records from the store, rather than allowing it to set their `deletedTimestamp` properties
     * @returns an array of `boolean` values to indicate success
     */
    removeRecords(ids: string[], overrideSoftDelete?: boolean): Promise<boolean[]>;
    /**
     * Restore a 'Record` that has been removed using the "soft delete" method.
     * @param id the id of the `Record` to restore
     * @returns a `boolean` to indicate success
     */
    restoreRecord: (id: string) => Promise<boolean>;
    /**
     * Restore 'Record`s that have been removed using the "soft delete" method.
     * @param ids the ids of the `Record`s to restore
     * @returns an array of `boolean` values to indicate success
     */
    restoreRecords: (ids: string[]) => Promise<any[]>;
    /**
     * Set the `deletedTimestamp` property of an `IRestorable` record.
     * @param id the id of the `Record` to update
     * @param value determines whether to set or delete the property. To set the property, this value should be `true`. To delete the property, this value should be `false`.
     * @returns a `boolean` to indicate success
     */
    setIsDeletedSingle(id: string, value: boolean): Promise<boolean>;
    /**
     * Set the `deletedTimestamp` properties of multpile `IRestorable` records to the same value.
     * @param ids the ids of the `Record`s to update
     * @param value determines whether to set or delete the property. To set the property, this value should be `true`. To delete the property, this value should be `false`.
     * @returns an array of `boolean` values to indicate success
     */
    setIsDeletedMultiple(ids: string[], value: boolean): Promise<any[]>;
    /**
     * Remove all records managed by this store
     * @returns a `boolean` to indicate success
     */
    clear(): Promise<unknown>;
}
/** A definition for an object that acts as key/value pairs to define a table schema.
*The key indicates the table name.
*The value indicates the indexes, separated by commas.
* @example { "users": "id, name", "profiles": "id, userId", "posts": "id, [userId+postType]", [...] }
*/
type RecordSetterSchema = {
    [key: string]: string;
};
/** Options for a `RecordSetter` instance */
interface RecordSetterOptions {
    name: string;
    version: number;
    schema: RecordSetterSchema;
    keyValueTableName?: string;
}
/** An asynchronous indexedDB wrapper that includes record management, query functions, and batch operations  */
declare class RecordSetter {
    #private;
    /** A map of the `RecordStore`s managed by this `RecordSetter` instance */
    stores: Map<string, RecordStore<RecordBase>>;
    /**
     * Create and then await and validate opening a `RecordSetter` instance
     * @param options target `RecordSetterOptions` values
     * @returns a validated `RecordSetter` instance
     */
    static activate(options: RecordSetterOptions): Promise<RecordSetter>;
    /**
     * Open the `RecordSetter` instance's database and initialize its functionality
     * @param options target `RecordSetterOptions` values
     * @returns a `boolean` to indicate success
     */
    open(options: RecordSetterOptions): Promise<boolean>;
    /**
     * Close the database connection and desconstruct the instance
     * @returns a `boolean` to indicate success
     */
    close(): Promise<boolean>;
    /**
     * Closes the current database instance, if it is open, and then deletes the database.
     * @returns a `boolean` to indicate success
     */
    delete(): Promise<boolean>;
    /**
     * Open new transaction in the managed database
     * @param tables the tables to include in this transaction scope
     * @param transactionMode the `IDBTransactionMode` the transaction will operate in
     * @returns a new transaction on the managed database in the target mode
     */
    openTransaction(tables: string[], transactionMode?: IDBTransactionMode): IDBTransaction;
    /**
     * Add a store to be managed by this `RecordSetter` instance
     * @param storeName the name of the store to add
     * @param tables the names of all tables that this store will share transactions with.
     * Transactions are shared in `Promise` scopes, so most `async`/`await` calls that will
     * unite record data from different tables require shared scopes.
     * @param options `RecordStoreOptions` values for the new `RecordStore` instance
     * @returns a new `RecordStore` instance
     */
    addStore<T extends RecordBase = RecordBase, R extends RecordStore<T> = RecordStore<T>>(storeName: string, tables?: string[], options?: RecordStoreOptions): R;
    /**
     * Get a `RecordStore` that is managed by this instance.
     * @template T extends `RecordBase`
     * @param name the name of the store to get
     * @returns a `RecordStore` instance that manages `Record`s of type `T`.
     */
    getStore<T extends RecordBase = RecordBase, R extends RecordStore<T> = RecordStore<T>>(name: string): R;
    /**
     * Get a default `RecordStore` instance that manages key/value pairs in the database
     * @returns the KeyValue `RecordStore` instance
     */
    getKeyValueStore(): Promise<RecordStore<RecordBase>>;
    /**
     * Get a value from the Key/Value `RecordStore`
     * @param key the key to match
     * @returns the value associated with the target key
     */
    getValue<T extends string | number | boolean | Blob | null | undefined = undefined>(key: string): Promise<T | null>;
    /**
     * Get values from the Key/Value `RecordStore`
     * @param keys the keys to match
     * @returns the values associated with the target keys
     */
    getValues<T extends string | number | boolean | Blob | null | undefined = undefined>(keys: string[]): Promise<(T | null)[]>;
    /**
     * Get all values from the Key/Value `RecordStore`
     * @returns an array of the values
     */
    getAllValues<T extends string | number | boolean | Blob | null | undefined = undefined>(): Promise<(T | null)[]>;
    /**
     * Set a value in the Key/Value `RecordStore`
     * @param key the key to assign a value to
     * @param value the value to assign to the target key
     */
    setValue<T extends string | number | boolean | Blob | null | undefined>(key: string, value: T): Promise<void>;
    /**
     * Set values in the Key/Value `RecordStore`
     * @param items an array of key/value pairs defining the data to set
     */
    setValues<T extends string | number | boolean | Blob | null | undefined>(items: {
        key: string;
        value: T;
    }[]): Promise<void>;
    /**
     * Get all data stored in the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to collect data from
     * @returns an array of all values stored in the target `IDBObjectStore`
     */
    getAllData<T extends string | number | boolean | Blob | null | undefined = undefined>(storeName: string): Promise<(T | null)[]>;
    /**
     * Get the value of an entry in the target `IDBObjectStore`, by key
     * @param storeName the name of the `IDBObjectStore` to get the value from
     * @param key the key to match
     * @returns the value assigned to the matching key, or null
     */
    getData<T extends string | number | boolean | Blob | null | undefined = undefined>(storeName: string, key: string): Promise<T | null>;
    /**
     * Get the values of the entries in the target `IDBObjectStore`, by keys
     * @param storeName the name of the `IDBObjectStore` to get the values from
     * @param keys the keys to match
     * @returns an array of the values assigned to the matching keys, or null
     */
    getDataValues<T extends string | number | boolean | Blob | null | undefined = undefined>(storeName: string, keys: string[]): Promise<(T | null)[]>;
    /**
     * Set the value of an entry in the target `IDBObjectStore`, by key
     * @param storeName the name of the `IDBObjectStore` to set the values in
     * @param key the key to match
     * @param value the value to assign to the matching key
     */
    setData<T extends string | number | boolean | Blob | null | undefined = undefined>(storeName: string, key: string | number, value: string | number | boolean | Blob | null | undefined): Promise<void>;
    /**
     * Set the values of an entries in the target `IDBObjectStore`, by keys
     * @param storeName the name of the `IDBObjectStore` to set the values in
     * @param values an array of key/value pairs defining the data to set
     */
    setDataValues(storeName: string, values: {
        key: string | number;
        value: string | number | boolean | Blob | null | undefined;
    }[]): Promise<void>;
    /**
     * Remove an entries from the target `IDBObjectStore`, by key
     * @param storeName the name of the `IDBObjectStore` to remove the values from
     * @param keys the keys to match
     */
    removeData(storeName: string, ...keys: (string | number)[]): Promise<void>;
    /**
     * Query the target `IDBObjectStore` for the target keys, and return all that exist.
     * @param storeName the name of the `IDBObjectStore` to query
     * @param keys the keys to match
     * @returns the matching keys that exist in the `IDBObjectStore`
     */
    getKeys(storeName: string, ...keys: string[]): Promise<string[]>;
    /**
     * Store a key, without an associated value, in the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to store the key in
     * @param key the value to store
     * @returns the value that was stored
     */
    setKey(storeName: string, key: string): Promise<unknown>;
    /**
     * Store keys, without associated values, in the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to store the keys in
     * @param keys the values to store
     * @returns an array of the stored keys
     */
    setKeys(storeName: string, keys: string[]): Promise<string[]>;
    /**
     * Removes a key from the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to remove the key from
     * @param key the key to remove
     */
    removeKey(storeName: string, key: string): Promise<void>;
    /**
     * Remove all keys from the target `IDBObjectStore`
     * @param storeName the name of the `IDBObjectStore` to remove the keys from
     */
    clearStoreKeys(storeName: string): Promise<void>;
    /**
     * Create a random, locally-unique string value to use as an id
     * @returns a `string` id value
     */
    static generateId(): string;
}

export { DataRecord, type IRestorableRecord, RecordBase, type RecordProperty, RecordSetter, type RecordSetterOptions, type RecordSetterSchema, RecordStore, type RecordStoreOptions };
