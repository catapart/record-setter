# Record Setter

A lightweight (~12kb minified, ~40kb verbose), single file, fully-typed, asynchronous indexedDB wrapper that includes a query function and batch operations.

## Quick Reference
```js
// vanilla
import { DataRecord, RecordSetter } from "./record-setter.min.js";
// npm
//import { RecordSetter } from "record-setter";

const DB_SCHEMA = 
{
    "users": "id, name",
    "profiles": "id, userId",
    "tasks": "id, userId, order",
    "attachments": "id, [type+taskId]",
    "images": "id, parentId, parentType, name",
    "notifications": "id, userId",
    "customKV": "key", // a single index of "key" makes a key/value object store (not a `RecordStore`)
    "tags": "key" // a single index of "key" can also be used to make a key-only object store (not a `RecordStore`)
};

const config = 
{
    name: "RecordSetter",
    version: 1,
    schema: DB_SCHEMA,
}

class UserRecord extends DataRecord
{
    name = "";
    email= "";
    description="";
    profileId = "";
}

async function init()
{
    // instantiate-then-init setup:
    // const data = new RecordSetter();
    // await data.open(config);

    // single-call setup:
    const data = await RecordSetter.activate(config);
    
    // open db before adding a store (`activate` opens the db);
    // the store needs a reference to the db instance
    data.addStore('users', ['users'], { useSoftDelete: true });
    await data.setData('customKV', 'hello', 'world');
    await data.setKey('tags', 'uno');
    await data.setKeys('tags', ['dos', 'tres']);


    const store = await data.getStore('users');
    if(store == null) { throw new Error("Store is null."); }

    const sortKey = "name"; // sort results by name
    // let records = await store.getAllRecords(sortKey);
        // or
    let records = await store.query({name: 'Test User'}, sortKey);

    if(records == null || records.length == 0)
    { 
        const user = new UserRecord();
        user.id = RecordSetter.generateId();
        user.name = "Test User";
        user.description = 'This should be updated';
        store.addRecord(user);
    }
    records = await store.getAllRecords();
    if(records == null) { throw new Error("Error storing user record."); }

    const record = records[0];
    record.description = "Updated Description";
    await store.updateRecord(record);
    await store.removeRecord(record.id);
    await store.restoreRecord(record.id);

    const savedRecord = await store.getRecord(record.id);

    await data.setValue('setting', true);
    const settingValue = await data.getValue('setting');
    
    document.body.innerHTML = `<div>
        <div>
            <div>Stores:</div>
            <pre><code>${JSON.stringify(Array.from(data.stores), null, 2)}</code></pre>
        </div>
        <div>
            <div>User Record:</div>
            <pre><code>${JSON.stringify(savedRecord, null, 2)}</code></pre>
        </div>
        <div>
            <div>Settings Value:</div>
            <pre><code>${JSON.stringify(settingValue, null, 2)}</code></pre>
        </div>
        <div>
            <div>Custom Key/Value Value:</div>
            <pre><code>${JSON.stringify((await data.getData('customKV', 'hello')), null, 2)}</code></pre>
        </div>
        <div>
            <div>Key-Only Values:</div>
            <pre><code>${JSON.stringify((await data.getKeys('tags')), null, 2)}</code></pre>
        </div>
    </div>`;
}
document.addEventListener('DOMContentLoaded', init);
```
*This reference content is valid javsacript and can be copied into a js file to run as an example.*

## Support
- Firefox
- Chrome
- Edge
- <s>Safari</s> (Has not been tested; should be supported, based on indexedDB support)

## Design
Record Setter is designed to work with "records" in a similar way to structured databases like SQL/SQLite. IndexedDB is capable of storing a wider variety of object types, but Record Setter is designed to be make porting data setting to other languages as easy as possible.

To achieve this, Record Setter uses object stores within indexedDB as analogues to SQL's "tables". These tables are defined in a schema, like actual database tables are, with two important differences:  
 - Actual queries are not available on indexedDB object stores, so cursors are used to match indexes which must be explicitly defined in order to use them for lookups. Put more simply: You have to tell the "database" which properties of an object you are going to query on, and they are not allowed to be `boolean` values(There are other rules, too: https://developer.mozilla.org/en-US/docs/Web/API/IDBIndex).  
 It is recommended to use indexes for primary and foreign keys and to use either strings or numbers for those keys.
 - The objects stored in object stores are not parsed into columns and are not limited to their original properties. It is the recommended convention of this library to use the properties of [`Record` objects](#datarecord) as column names and not change those properties once they have been established.  
 Important to note, though, that you can actually add any properties to the objects at any time.

## Getting Started
 1. [Install/Reference the library](#referenceinstall)
 1. [Set up the Schema](#schema)
 1. [Define Records](#define-records)
 1. [Open an Instance](#open-an-instance)
 1. [Add Stores](#add-stores)
 1. [Manage Data](#data-management)
 

### Reference/Install
#### HTML Import (not required for vanilla js/ts; alternative to import statement)
```html
<script type="module" src="/path/to/record-setter[.min].js"></script>
```
#### npm
`npm install record-setter`

### Import
#### Vanilla js/ts
```js
import { RecordSetter } from "/path/to/record-setter[.min].js";
```
#### npm
```js
import { RecordSetter } from "record-setter";
```

### Setup

#### Schema
The schema defines each "table" and any properties that will be used to query those tables. Every record needs an `id` index[*](#if-every-table-needs-an-id-why-not-make-the-library-add-it). The other properties are examples.
```js
const DB_SCHEMA:RecordSetterSchema = 
{
    "users": "id",
    "profiles": "id, userId",
    "tasks": "id, userId, order",
    "attachments": "id, [type+taskId]",
    "images": "id, parentId, parentType",
    "notifications": "id, userId",
};
```    
*These bullet points describe the hypothetical data requirements of the example schema above, to illustrate what the syntax describes more clearly:*
- `profiles` are queried based on the `userId` they are associated with.
- When collecting `tasks`, we want to establish their order so that property will be in the query. (**Every** record type that needs to return from the query in an order will need to have the `order` property included in its schema definition, here.)
- Every time we query for `attachments`, we'll want to reference the `type` as well as its parent `taskId` for matching. Since it will always be referenced that way, it's faster to just make the index join those two properties rather than searching them each, separately. To indicate this, we use indexedDB syntax seen above.
- `images` are queried by their `parentId`, alone, for listing, and also queried by their `parentType` paired with their `parentId` for determining whether or not to display them in the gallery or as profile pictures. That means there is an index for `parentId` and an index for `parentType`, but *not* a combinded index because we still want to use at least one of those properties for queries by itself.

#### Define `Record`s
Once the schema has been defined, `Record` objects can be used to define the columns of the data store. `Record` objects are expected to be completely "flat" - without any sub objects. They are also expected to only use properties of the following types:
- `string`
- `number`
- `boolean`
- `Blob`
- Properties can also be `undefined` or `null`

All `Record`s are expected to have an `id` property that is a `string` type value.  
If you are using the "soft delete" method for removing records, the `Record` will also be expected to have a `deletedTimestamp` property that is a `number` type value.  
To facilitate including these properties, Record Setter provides a `DataRecord` type for extending. (For records that will **not** be using the "soft delete" method, the `RecordBase` type is also available.)

Examples:
```js
export class ProfileRecord extends DataRecord
{
    userId: string = "";
    profileImageId: string = "";
}
export class TaskRecord extends DataRecord
{
    userId: string = "";
    order: number = -1;
    color: string = "#858585";
    description: string = "";
    isFinished: boolean = false;
}
export enum ImageParentType
{
    ProfilePicture,
    Upload
}
export class ImageRecord extends DataRecord
{
    parentId:string = "";
    name: string = "";
    description: string = "";
    parentType: ImageParentType = ImageParentType.Upload;
    image: Blob;
}
```

#### Open an Instance
Provide a `name`, an indexedDB `version` number, and a valid schema object to the `open` function in order to prepare your database.  
This function handles upgrading the db, if you've changed the version/schema, and stores a references to the database that all of the `RecordStore` instances will have transactional access to.
```js
const data = new RecordSetter();
const config: RecordSetterOptions = 
{
    name: "MyData",
    version: 1,
    schema: DB_SCHEMA,
}
await data.open(config);
```

##### Versioning
If you want to make a change to your DB Schema, but you do not want to lose the information that is currently stored, you will need to increment the version number.  
For development, iteration can usually be done by deleting the database from the dev tools, rather than upgrading. But once the data is in a production setting, the only way to preserve data while changing the schema - including just adding new tables/properties - will require a version increment.  
Typical indexedDB restrictions apply for how the schema can change, but otherwise an upgrade can be entirely completed just by updating the version number alongside the scheme change.

#### Add Stores
Stores are a dual-purpose abstraction for dealing with `Record`s. The first thing stores do is "simplify" the indexedDB requirement of every `Transaction` to know all of it's subsidiary transactions[*](#transactions). The second thing they do is provide better type inference and explicit type-casting for Typescript.

To add a store, pass in the store's name (as defined in the schema), along with an array of any other store names that will be needed for this store's transactions.
```js
data.addStore<ImageRecord>('images', [ 'customImages' ], { useSoftDelete: true });
data.addStore<NotificationRecord>('notifications', ['notifications']);
```
Note that the `notifications` store does not use a soft delete. This means that any time the `removeItem` or `removeItems` functions are used, with that store, the object will be fully removed from the database, rather than just having it's `deletedTimestamp` property assigned.

For soft deletes, Record Setter does not manage the maintenance for those records. If you want to actually delete them from the database, you will need to call `removeItem` or `removeItems` with the `overrideSoftDelete` parameter set as `true`.

### Data Management
Get a reference to the store, then use the API to manage that store's records.
```js
const usersStore = data.getStore<User>('users');
const profilesStore = data.getStore<Profile>('profiles');

const sortKey = 'order';
const equalityPredicate = { name: 'Match' };
const overrideSoftDelete = true;

await usersStore.getAllRecords(sortKey);
await usersStore.getRecord(id);
await usersStore.getRecords(ids, 'order');
await usersStore.query(equalityPredicate, sortKey);
await usersStore.updateRecord(record);
await usersStore.updateRecords(records);
await usersStore.removeRecord(id, false);
await usersStore.removeRecords(ids, overrideSoftDelete);
await usersStore.restoreRecord(id);
await usersStore.restoreRecords(ids);
```
In Typescript, providing the store type to the `getStore` function types all of that store's methods with the provided type.

### Queries
Queries can only be done on a single store at a time.  
Queries can also only be done using property names for properties that have been defined as indexes in the [schema](#schema).  
There is no limit to how many properties you can use as indexes, but you may not use the same property twice (even to re-use it in combination indexes), there are restrictions to the types that can be indexes (no `boolean`s; that's a maximum index of two records), and each index incurs a data overhead.

Indexes are lightweight, by design, and are meant for fast execution, but they are direct copies of property values, so you will end up duplicating each property that you have as an index, in your databse. With `number`s, this is negligible. But if you try to put an index on a property that contains a `Blob`, that's probably going to cause problems. And if you index really long `string`s, or something, you could run into the same issue.

#### Single Predicate
Query for records that have a single property which matches the value.  
The object's property name is the property to match on the records, and the object's property value is the value to match on the records.
```js
const equalityPredicate = { name: 'Name ToMatch' };
```

#### Collection Predicate
Query for records that have a single property which match any values in the property value array.  
The object's property name is the property to match on the records, and the object's property value is an array of *any* of the values to match on the records.  
Collection Predicates can only contain a single property to match on.
```js
const equalityPredicate = { name: ['Name ToMatch', 'Another Name ThatWillMatch'] };
```

#### Multiple Predicate
Query for records that have multiple properties which match the values.  
The object's property names are the properties to match on the records, and the object's property values are the values to match on the records.
```js
const equalityPredicate = { name: 'Name ToMatch', age: 26 };
```

#### Joins and Other Database Operations
Joins and any other type of operation that converges two different "tables" (object stores) into a single output are not supported by Record Setter. indexedDB does not support any kind of actual foreign-key functionality, so there's no underlying method of navigating the data that way.

## Non-Record Storage
### Key/Value Storage
Record Setter includes a simple key/value store for convenience. This store can be accessed like any other store, via the `getStore` method. The name of this store is configurable, if you want to use that method to get the store.

For convenience, the key value store has top level functions in the `RecordSetter` object that can directly get and set values:
```js
const key = 'settingName';
const value: T = 'any kind of data that can be stored in indexedDB';
await data.getValue<T>(key);
await data.setValue(key, value);
```
Note that since the key/value store does not have to store records, the only limitation on types to be stored are the types accepted by indexedDB.

This store is a kind of drop-in replacement for `localStorage`, so you can keep all of your data in the indexedDB storage, rather than storing "simpler" data elsewhere.

### Data Storage
Record Setter supports storing non-record data via the `getData` and `setData` methods, and their sibling methods.  
These are the underlying methods that support the Key/Value storage, and they can be thought of as direct access to custom key/value stores that you would like to use. If you data does not need all of the support of Record storage, you can use these methods to bypass adding `RecordStore` objects, alltogether.

To set Key/Value data, you do *not* need to pass it a `RecordStore` name. The stores that these methods target are `IDBObjectStore` objects, so you only need a string to use them.
```js
const DB_SCHEMA = 
{
    [...]
    "customKV": "key", // a single index of "key" makes a key/value object store (not a `RecordStore`)
};
[...]
await data.setData('customKV', 'hello', 'world');
await data.setData('customKV', 'test', 21);
await data.setData('customKV', 'other', true);

await data.getData('customKV', 'hello');
```

### Key-Only Storage
Record Setter supports storing key-only data with the `getKeys` and `setKey` methods, and their sibling methods.  
Key-Only storage is useful for things like storing "tags". Forcing a tag to be associated with a key or an id just means adding extra data that couples the tag to specific structures - at best - and duplicates the tags data in worse cases.

Like Data Storage, Key-Only storage deals directly with a `IDBObjectStore`, rather than a `RecordStore`, so the target store name is only an object store name, rather than a record store name.
```js
const DB_SCHEMA = 
{
    [...]
    "tags": "key", // a single index of "key" makes an object store (not a `RecordStore`) that can be used as key-only
};
[...]
await data.setKey('tags', 'uno');
await data.setKeys('tags', ['dos', 'tres']);

await data.getKeys('tags');
```

## Utilities
- `generateId`: this function creates a 'random', 'locally-unique' string value to use as an id. It's not a UUID (shorter, but still not readable), so it's not as hardened against collisions, but it is random enough to support all tested use-cases. If your project only needs local ids, this function can be used to generate them.

## Additional Notes
### Metrics?
No perfomance testing has been conducted on this library at all.

If performance is a priority, this is probably not the library you want to use. This library's priority is convenience. 

### If every "table" needs an `id`, why not make the library add it?
If I wanted to edit the library (not as a library change, but when localizing a derivative library to a project), I don't want to have to remove that kind of 'boilerplating'. Every time I set about wanting to include that, I decided it wouldn't really be any more work for me to just set up that kind of functionality in an external "schema-generator" function, so that seems like the more appropriate option.

### Transactions
As an example, a query for a `User` cannot provide any data for another record type, like `Profile`, if that table isn't explicitly defined in the transaction.  
That is deceptively simplistic because indexedDB `Transaction`s don't "complete" and commit their changes to the DB until the javascript "Frame" has finished. This really messes with `async`/`await` functionality because if you wrap a `Transaction` in a `Promise`, that `Transaction` will be 'live' until the `Promise` has been resolved. 

That makes code like this not work right:
```js
data.addStore<UserRecord>('users', [ 'users' ]);
data.addStore<ProfileRecord>('profiles', [ 'profiles' ]);
async function composeUser(id: string)
{
    const store = data.getStore<UserRecord>('users');
    const userRecord = await store.getRecord(id);
    
    const profilesStore = data.getStore<ProfileRecord>('profiles');
    const profileRecord = await profilesStore.getRecord(userRecord.profileId);

    return new RuntimeUser(userRecord, profileRecord);
}

const user = await composeUser(userId);
```
Since `getRecord` was called in an async function and that function does not complete before another `getRecord` call is made, the first transaction will not be completed yet. So when the profilesStore tries to start a new transaction, an error will be thrown. Since we're still in the user's transaction, that transaction will roll itself back to preserve data integrity. The end result is that you won't have any data stored.

To make this all work right, you have to tell each store all of the "related" tables that will be invoked when an record is requested, even if those tables will only be invoked in the same Promise scope, rather than in the same data request. For most tables, this is only their own table. But for "parent" records, you'll need to include all child (and grandchild; all decendants) record tables that you plan on composing the runtime object with.  

Fixing the example above (just include `profiles` in the tables parameter of `addStore`):
```js
data.addStore<UserRecord>('users', [ 'users', 'profiles' ]);
data.addStore<ProfileRecord>('profiles', [ 'profiles' ]);
async function composeUser(id: string)
{
    const store = data.getStore<UserRecord>('users');
    const userRecord = await store.getRecord(id);
    
    const profilesStore = data.getStore<ProfileRecord>('profiles');
    const profileRecord = await profilesStore.getRecord(userRecord.profileId);

    return new RuntimeUser(userRecord, profileRecord);
}

const user = await composeUser(userId);
```

### SQL/SQLite-like?
Not really, no. IndexedDB is not those things and trying to make it act (kindof, sortof, if you squint) like those things incurs plenty of cost. This library's intention is not to be performant, robust, or durable like those technologies. This library intends to make the *other code* you write similar enough to how you could write it for those other technologies that it can be ported to them easily.  
The main intention is to let Record Setter be a web-native data storage module that can be replaced by a platform-native, or cloud-native data storage module, depending upon the environment. While the other technologies are still expected to have to be wrapped/abstracted in order to provide a compatible API to Record Setter, those wrappers won't be expected to deal with dynamic data types or complex object storage.

As an example of the intention: think of a progressive web app that runs natively on the web, in a browser. If you wanted to then publish that code in a native app, there would be some amount of porting, but the biggest issue would be in getting the data in whatever format the native app environment would support. While indexedDB might still work in a webview, it wouldn't be a robust solution due to indexedDB's volatility. So porting to a native data solution would be an easy upgrade for the native version of the app. But if doing so meant having to rewrite your entire data layer because you wrote it strictly to work with indexedDB, that is not a simple port. If you were using Record Setter, on the other hand, hopefully it would be a pretty one-to-one translation.

### `Record`s as a type
Records are ways to structure data and they can get really messy, really fast, if you try to treat them like "Objects" or "Classes" or anything other than just dumb data stores.  
This includes trying to add getter/setters, or helper functions to normalize how you access that data.

General practice separates "Record" objects from "Runtime" objects to prevent complicating Records. Record Setter only deals with "Record" type objects and should not be used with non-Record types.

There are a lot of patterns for translating "Record" objects into "Runtime" versions of those objects and they often depend on the rest of your architecture. If you're using MVC, you might just pass a record to a controller and have that be enough. If you're doing more direct object handling, you may want to force an object to use a record in its constructor, or supply the record data in an initialization function, after it's been constructed.

The main point to note is that it is likely to come back to bite you if you try to take the 'shortcut' of including non-data code in your records.

### License
This library is in the public domain. You do not need permission, nor do you need to provide attribution, in order to use, modify, reproduce, publish, or sell it or any works using it or derived from it.