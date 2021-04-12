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
      displayName text UNIQUE,
      profilePicture text,
      email text UNIQUE NOT NULL
      );`)
      .then(() => {
        // Table established
        console.log('Established user table');
      })
      .catch(err => {
        console.log(err.message);
      });

    db.run(`CREATE TABLE IF NOT EXISTS groups (
        groupId INTEGER PRIMARY KEY AUTOINCREMENT,
        groupName text NOT NULL,
        groupPicture text,
        groupDescription text,
        isPrivate integer NOT NULL
        );`)
      .then(() => {
        // Table established
        console.log('Established group table');
      })
      .catch(err => {
        console.log(err.message);
      });

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
      });

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
      });

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
      });

    db.run(`CREATE TABLE IF NOT EXISTS registration (
        registrationId INTEGER PRIMARY KEY AUTOINCREMENT,
        userId references user(googleId),
        groupId references groups(groupId),
        rankId references rank(rankId)
        );`)
      .then(() => {
        // Table established
        console.log('Established registration table');
      })
      .catch(err => {
        console.log(err.message);
      });

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
      });

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
      });
  })
  .catch(err => {
    // Can't open database
    console.log(err.message);
    throw err;
  });

// User Table Functions

exports.getOwnProfile = async function (userId) {
  // Get private user information from the database using their Google ID as a selector
  const sql = `SELECT * FROM user WHERE googleId = "${userId}";`;
  const response = await db.get(sql)
    .then(row => {
      return { failed: false, context: row };
    })
    .catch(err => {
      return { failed: true, context: err };
    });
  return response;
};

exports.getOtherProfile = async function (userId) {
  // Get public user information from the database using their Google ID as a selector
  const sql = `SELECT name, displayName, profilePicture FROM user WHERE googleId = "${userId}";`;
  const response = await db.get(sql)
    .then(row => {
      return { failed: false, context: row };
    })
    .catch(err => {
      return { failed: true, context: err };
    });
  return response;
};

exports.addUser = async function (values) {
  // Insert new record into User Table
  const sql = 'INSERT INTO user (googleId, name, displayName, profilePicture, email) VALUES (?, ?, ?, ?, ?)';
  await db.run(sql, values);
};

exports.deleteUser = async function (userId) {
  // Delete user record based on their Google ID
  const sql = `DELETE FROM user WHERE googleId = "${userId}"`;
  await db.run(sql);
};

// CREATE

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

async function addRegistration(values) {
  const sql = 'INSERT INTO registration (groupId, userId, rankId) VALUES (?, ?, ?)';
  let response = await db.run(sql, values)
    .then(() => {
        return null;
    })
    .catch(err => {
        return err;
    })
  return response;
}

async function addGrievance(values) {
  const sql = 'INSERT INTO grievance (prosecutorId, defendantId, documentId, replyId, content) VALUES (?, ?, ?, ?, ?)';
  let response = await db.run(sql, values)
    .then(() => {
        return null;
    })
    .catch(err => {
        return err;
    })
  return response;
}

async function addShare(values) {
  const sql = 'INSERT INTO share (documentId, groupId) VALUES (?, ?)';
  let response = await db.run(sql, values)
    .then(() => {
        return null;
    })
    .catch(err => {
        return err;
    })
  return response;
}

async function addGroup(values, admin) {
  const sql = 'INSERT INTO groups (groupName, groupPicture, groupDescription) VALUES (?, ?, ?)';
  let response = await db.run(sql, values)
    .then(() => {
        return null;
    })
    .catch(err => {
        return err;
    })

  // Once a group is created, the creator needs the rank of owner
  const id = await db.get('SELECT last_insert_rowid() as rowid;')
    .then(row => {
      return row.rowid;
    });
  const groupId = await db.get('SELECT groupId from groups where rowid = ?', id)
    .then(row => {
      return row.groupId;
    });

  const data = [groupId, 'Owner', 0, null, 1, 1, 1, 1];
  let rankResponse = await addRank(data)
    .then(() => {
      return null;
    })
    .catch(err => {
      return err;
    })

  if (rankResponse) {
    console.log(rankResponse);
    return rankResponse;
  }
  return response;
}

async function addRank(values) {
  const sql = 'INSERT INTO rank (groupId, rankName, level, colour, canPost, canReply, canRemove, canBan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  let response = await db.run(sql, values)
    .then(() => {
        return null;
    })
    .catch(err => {
        return err;
    })
  return response;
}

// RETRIEVE

module.exports.getAllUsers = async function () {
  const sql = 'SELECT * FROM user;';
  const response = await db.get(sql)
    .then(rows => {
      return { failed: false, context: rows };
    })
    .catch(err => {
      return { failed: true, context: err };
    });
  return response;
};

async function getUserById(userId) {
  // Get user information from the database using their Google ID as a selector
  let sql = `SELECT * FROM user WHERE googleId = "${userId}";`;
  let response = await db.get(sql)
    .then(row => {
      return {failed: false, context: row};
    })
    .catch(err => {
      return {failed: true, context: err};
    })
  return response;
}

async function getViewableDocs(userId) {
  // I just know this SQL is gonna be disgusting and I haven't written it yet
  let sql = `
  SELECT *
  FROM document
  INNER JOIN share ON share.documentId = document.documentId
  INNER JOIN groups ON groups.groupId = share.groupId
  INNER JOIN registration ON registration.groupId = groups.groupId
  INNER JOIN user ON user.googleId = registration.userId
  WHERE user.googleId = ${userId};`;
  let response = await db.get(sql)
    .then(row => {
      return {failed: false, context: row};
    })
    .catch(err => {
      return {failed: true, context: err};
    })
  return response;
}
/*
module.exports.addUser = addUser;
module.exports.addDoc = addDoc;
module.exports.addReply = addReply;
module.exports.addRegistration = addRegistration;
module.exports.addGrievance = addGrievance;
module.exports.addShare = addShare;
module.exports.addGroup = addGroup;
module.exports.addRank = addRank;
module.exports.getUserById = getUserById;
module.exports.getViewableDocs = getViewableDocs;
*/
