declare class DataRecord {
    id: string;
}
type RecordProperty = string | number | boolean | Blob;
interface RecordStoreOptions {
    useSoftDelete?: boolean;
    softDeleteTimestampPropertyName?: string;
}
declare class RecordStore<T extends DataRecord = DataRecord> {
    #private;
    constructor(database: IDBDatabase, storeName: string, tables: string[], options?: RecordStoreOptions);
    openTransaction(transactionMode?: IDBTransactionMode): IDBTransaction;
    addRecord(record: T): Promise<boolean>;
    addRecords(records: T[]): Promise<boolean[]>;
    getRecord(id: string): Promise<T | null>;
    getRecords(ids: string[], sortKey?: string): Promise<T[]>;
    getAllRecords(sortKey?: string): Promise<T[]>;
    query(equalityPredicate: {
        [key: string]: unknown;
    }, sortKey?: string | undefined): Promise<T[]>;
    updateRecord(record: T): Promise<T>;
    updateRecords(records: T[]): Promise<T[]>;
    removeRecord(id: string, overrideSoftDelete?: boolean): Promise<boolean>;
    removeRecords(ids: string[], overrideSoftDelete?: boolean): Promise<boolean[]>;
    restoreRecord: (id: string) => Promise<boolean>;
    restoreRecords: (ids: string[]) => Promise<any[]>;
    setIsDeletedSingle(id: string, value: boolean): Promise<boolean>;
    setIsDeletedMultiple(ids: string[], value: boolean): Promise<any[]>;
    clear(): Promise<unknown>;
}
interface RecordSetterOptions {
    name: string;
    version: number;
    schema: {
        [key: string]: string;
    };
    keyValueTableName?: string;
}
declare class RecordSetter {
    #private;
    stores: Map<string, RecordStore<DataRecord>>;
    open(options: RecordSetterOptions): Promise<boolean>;
    private openDatabase;
    private createDatabase;
    private createStorePromise;
    close(): Promise<boolean>;
    delete(): Promise<boolean>;
    private deleteDatabase;
    addStore<T extends DataRecord = DataRecord, R extends RecordStore<T> = RecordStore<T>>(storeName: string, tables?: string[], options?: RecordStoreOptions): R;
    getStore<T extends DataRecord = DataRecord, R extends RecordStore<T> = RecordStore<T>>(name: string): R;
    getKeyValueStore(): Promise<RecordStore<DataRecord>>;
    getValue<T extends string | number | boolean | Blob | null | undefined = undefined>(key: string): Promise<T | null>;
    getValues<T extends string | number | boolean | Blob | null | undefined = undefined>(keys: string[]): Promise<(T | null)[]>;
    getAllValues<T extends string | number | boolean | Blob | null | undefined = undefined>(): Promise<(T | null)[]>;
    setValue<T extends string | number | boolean | Blob | null | undefined>(key: string, value: T): Promise<unknown>;
    setValues<T extends string | number | boolean | Blob | null | undefined>(items: {
        key: string;
        value: T;
    }[]): Promise<void>;
    getAllData<T extends string | number | boolean | Blob | null | undefined = undefined>(storeName: string): Promise<(T | null)[]>;
    getData<T extends string | number | boolean | Blob | null | undefined = undefined>(storeName: string, key: string): Promise<T | null>;
    getDataValues<T extends string | number | boolean | Blob | null | undefined = undefined>(storeName: string, ids: string[]): Promise<(T | null)[]>;
    setData<T extends string | number | boolean | Blob | null | undefined = undefined>(storeName: string, key: string | number, value: string | number | boolean | Blob | null | undefined): Promise<unknown>;
    setDataValues(storeName: string, values: {
        key: string | number;
        value: string | number | boolean | Blob | null | undefined;
    }[]): Promise<void>;
    removeData(storeName: string, ...keys: (string | number)[]): Promise<unknown>;
    getKeys(storeName: string, ...keys: string[]): Promise<string[]>;
    setKey(storeName: string, key: string): Promise<unknown>;
    setKeys(storeName: string, keys: string[]): Promise<string[]>;
    removeKey(storeName: string, key: string): Promise<unknown>;
    clearStoreKeys(storeName: string): Promise<unknown>;
    openTransaction(tables: string[], transactionMode?: IDBTransactionMode): IDBTransaction;
    static generateId(): string;
}

export { DataRecord, type RecordProperty, RecordSetter, type RecordSetterOptions, RecordStore, type RecordStoreOptions };
