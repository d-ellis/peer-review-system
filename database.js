const database = require('sqlite-async');
const DBSOURCE = 'sqlite.db';

let db;
database.open(DBSOURCE)
  .then(_db => {
    db = _db;
    // Connection established. Create tables
    console.log('Connection to SQLite database has been established!');
    db.run(`CREATE TABLE IF NOT EXISTS user (
      googleId PRIMARY KEY NOT NULL,
      name text NOT NULL,
      displayName text,
      profilePicture text,
      email text UNIQUE NOT NULL
      );`)
      .then(() => {
      // Table established
      console.log('Established user table');
    })
      .catch(err => {
      console.log(err.message);
    })

    db.run(`CREATE TABLE IF NOT EXISTS groups (
        groupId INTEGER PRIMARY KEY AUTOINCREMENT,
        groupName text NOT NULL,
        groupPicture text,
        groupDescription text
        );`)
      .then(() => {
          // Table established
          console.log('Established group table');
        })
      .catch(err => {
          console.log(err.message);
        })

    db.run(`CREATE TABLE IF NOT EXISTS category (
        categoryId INTEGER PRIMARY KEY AUTOINCREMENT,
        categoryName text NOT NULL,
        parentCategory references category(categoryId)
        );`)
      .then(() => {
          // Table established
          console.log('Established category table');
        })
      .catch(err => {
          console.log(err.message);
        })

    db.run(`CREATE TABLE IF NOT EXISTS document (
      documentId INTEGER PRIMARY KEY AUTOINCREMENT,
      author references user(googleId) NOT NULL,
      title text NOT NULL,
      file text NOT NULL,
      timeCreated integer NOT NULL,
      lastEditted integer
      );`)
      .then(() => {
        // Table established
        console.log('Established document table');
      })
      .catch(err => {
        console.log(err.message);
      })

    db.run(`CREATE TABLE IF NOT EXISTS document_categories (
        documentCatId INTEGER PRIMARY KEY AUTOINCREMENT,
        categoryId references category(categoryId),
        documentId references document(documentId)
        );`)
      .then(() => {
          // Table established
          console.log('Established document_categories table');
        })
      .catch(err => {
          console.log(err.message);
        })

    db.run(`CREATE TABLE IF NOT EXISTS share (
        shareId INTEGER PRIMARY KEY AUTOINCREMENT,
        documentId references document(documentId),
        groupId references groups(groupId)
        );`)
      .then(() => {
          // Table established
          console.log('Established share table');
        })
      .catch(err => {
          console.log(err.message);
        })

    db.run(`CREATE TABLE IF NOT EXISTS rank (
        rankId INTEGER PRIMARY KEY AUTOINCREMENT,
        groupId references groups(groupId),
        rankName text NOT NULL,
        level integer NOT NULL,
        colour text,
        canPost integer NOT NULL,
        canReply integer NOT NULL,
        canRemove integer NOT NULL,
        canBan integer NOT NULL
        );`)
      .then(() => {
          // Table established
          console.log('Established rank table');
        })
      .catch(err => {
          console.log(err.message);
        })

    db.run(`CREATE TABLE IF NOT EXISTS registration (
        registrationId INTEGER PRIMARY KEY AUTOINCREMENT,
        groupId references groups(groupId),
        userId references user(googleId),
        rankId references rank(rankId)
        );`)
      .then(() => {
          // Table established
          console.log('Established registration table');
        })
      .catch(err => {
          console.log(err.message);
        })

    db.run(`CREATE TABLE IF NOT EXISTS reply (
      replyId INTEGER PRIMARY KEY AUTOINCREMENT,
      author references user(googleId) NOT NULL,
      document references share(shareId) NOT NULL,
      parentReply references reply(replyId),
      content text NOT NULL,
      timeCreated integer NOT NULL
      );`)
      .then(() => {
        // Table established
        console.log('Established reply table');
      })
      .catch(err => {
        console.log(err.message);
      })

    db.run(`CREATE TABLE IF NOT EXISTS grievance (
        grievanceId INTEGER PRIMARY KEY AUTOINCREMENT,
        prosecutorId references user(googleId),
        defendantId references user(googleId),
        documentId references share(shareId),
        replyId references reply(replyId),
        content text
        );`)
      .then(() => {
          // Table established
          console.log('Established grievance table');
        })
      .catch(err => {
          console.log(err.message);
        })

  })
  .catch(err => {
    // Can't open database
    console.log(err.message);
    throw err;
  })

async function addUser(values) {
  const sql = 'INSERT INTO user (googleId, name, displayName, profilePicture, email) VALUES (?, ?, ?, ?, ?)';
  let response = await db.run(sql, values)
    .then(() => {
      return null;
    })
    .catch(err => {
      return err;
    })
  return response;
};

async function addDoc(values) {
  const sql = 'INSERT INTO document (title, author, file, timeCreated, lastEditted) VALUES (?, ?, ?, ?, ?)';
  let response = await db.run(sql, values)
    .then(() => {
        return null;
      })
    .catch(err => {
      return err;
    })
  return response;
}

async function addReply(values) {
  const sql = 'INSERT INTO reply (document, content, parentReply, author, timeCreated) VALUES (?, ?, ?, ?, ?)';
  let response = await db.run(sql, values)
    .then(() => {
        return null;
      })
    .catch(err => {
      return err;
    })
  return response;
}

async function getUserById(userId) {
  // Get user information from the database using their Google ID as a selector
  let sql = `SELECT * FROM user WHERE googleId = ${userId};`;
  let response = await db.get(sql)
    .then(row => {
      return {failed: false, context: row};
    })
    .catch(err => {
      return {failed: true, context: err};
    })
  return response;
}

module.exports.addUser = addUser;
module.exports.addDoc = addDoc;
module.exports.addReply = addReply;
module.exports.getUserById = getUserById;
