const config = require('../config');
const db = require('./database.js');


const { DownloaderHelper } = require('node-downloader-helper');

require('express-zip');
const fs = require('fs');
const { promisify } = require('util');
const renameAsync = promisify(fs.rename);


// -- ADMIN FUNCTIONS --
exports.wipeEmails = async function (req, res) {
  const response = await db.wipeEmails();
  if (response.failed) {
    console.log(response);
    res.sendStatus(500);
    return;
  }

  res.sendStatus(200);
};

exports.getFromTableWherePrimaryKey = async function (req, res) {
  const response = await db.getRecordByPrimaryKey(req.params.table, req.params.value);
  if (response.failed || response.code) {
    const httpCode = response.code || 500;
    res.sendStatus(httpCode);
  } else {
    res.status(200).json({
      data: response.context,
    });
  }
};

exports.getAllInTable = async function (req, res) {
  const response = await db.getAllInTable(req.params.table);
  if (response.failed) {
    res.sendStatus(500);
  } else {
    res.status(200).json({
      data: response.context,
    });
  }
};


// -- USER FUNCTIONS --
exports.createNewUser = async function (req, res) {
  const name = req.user.name.givenName;
  const email = req.user.emails[0].value;
  const username = 'User' + req.user.id;
  const picture = req.user.photos[0].value;

  // Extract adapted from https://www.geeksforgeeks.org/how-to-download-a-file-using-node-js/
  let file;
  // Download Google profile picture
  const dl = new DownloaderHelper(picture, config.uploads);
  dl.on('end', data => {
    file = data;
  });
  await dl.start();

  // Move and rename image file
  const fileExtList = file.fileName.split('.');
  const fileExt = fileExtList[fileExtList.length - 1];
  const newFilename = req.user.id + '.' + fileExt;
  await renameAsync(file.filePath, config.imageStore + newFilename);


  const userData = [req.user.id, username, name, email, newFilename, ''];
  const response = await db.createUser(userData);
  if (response.failed) {
    res.sendStatus(500);
    return;
  }
  // Add user to main public group
  const regResponse = await db.createRegistration([req.user.id, 1, 'member']);
  if (regResponse.failed) {
    res.sendStatus(500);
    return;
  }
  res.sendStatus(201);
};

exports.getCurrentUser = async function (req, res) {
  const response = await db.getRecordByPrimaryKey('user', req.user.id);
  if (response.failed) {
    // If an error occured, return 500
    res.sendStatus(500);
    return;
  }

  // If user wasn't found, return 404
  if (!response.context || response.context.length === 0) {
    res.sendStatus(404);
    return;
  }

  res.status(200).json({
    data: response.context,
  });
};

exports.getProfilePic = async function (req, res) {
  // If no user specified, return default image
  if (!req.params.userId) {
    res.sendFile(config.imageStore + 'default-profile-pic.jpg');
    return;
  }


  const response = await db.getUserPicture(req.params.userId);
  // If something went wrong, or picture not found, return default picture
  if (response.failed || !response.context || response.context.picture === '') {
    res.sendFile(config.imageStore + 'default-profile-pic.jpg');
    return;
  }

  const file = response.context.picture;

  // Check if file exists
  fs.access(config.imageStore + file, fs.F_OK, (err) => {
    if (err) {
      // If doesn't exists, send default
      res.sendFile(config.imageStore + 'default-profile-pic.jpg');
      return;
    }
    // Else send file
    // Send profile picture
    res.sendFile(config.imageStore + file);
  });
};

exports.updateUser = async function (req, res) {
  // Get current user profile to compare username
  const user = await db.getRecordByPrimaryKey('user', req.user.id);
  if (user.failed) {
    res.sendStatus(404);
    return;
  }

  // If fields not provided, return 404
  if (!req.body.newUsername || !req.body.newName) {
    res.sendStatus(404);
    return;
  }

  // If username not owned by current user, check if unique
  if (user.context.username !== req.body.newUsername) {
    const isUnique = await checkUsername(req.body.newUsername);
    // If not unique, return 400
    if (!isUnique) {
      res.sendStatus(400);
      return;
    }
  }

  // Update database
  const data = [req.body.newUsername, req.body.newName, req.user.id];
  const update = await db.updateUser(data);
  // If failed, return 500
  if (update.failed) {
    console.log(update);
    res.sendStatus(500);
    return;
  }

  res.sendStatus(204);
};

exports.updateProfilePic = async function (req, res) {
  // Get picture from database ready to fs.unlink it
  const picRetrieval = await db.getUserPicture(req.user.id);
  if (picRetrieval.failed) {
    console.log(picRetrieval.context);
    res.sendStatus(500);
    return;
  }
  let picture = picRetrieval.context.picture;

  if (picture.length !== 0) {
    // Mark old picture for deletion
    fs.appendFile(config.redundants, config.imagePath + picture + ',', (err) => {
      if (err) throw err;
    });
  }

  picture = '';
  if (req.file) {
    // If updating picture, handle file upload
    const file = req.file;
    // Get the file extension and add it to the random file name
    const fileExtList = file.originalname.split('.');
    const fileExt = fileExtList[fileExtList.length - 1];
    picture = file.filename + '.' + fileExt;
    // Move file and rename it with extension
    await renameAsync(file.path, config.imageStore + picture);
  }

  // Change database entry
  const data = [picture, req.user.id];
  const update = await db.updateUserPicture(data);
  if (update.failed) {
    console.log(update.context);
    res.sendStatus(500);
    return;
  }

  res.sendStatus(204);
};


// -- COHORT FUNCTIONS --
exports.createUpdateCohort = async function (req, res) {
  // If required data not found, return 400
  if (!req.body.cohortName || !req.body.cohortDesc) {
    res.sendStatus(400);
    return;
  }
  if (req.body.cohortName.length === 0 || req.body.cohortDesc.length === 0) {
    res.sendStatus(400);
    return;
  }

  // Format data correctly
  if (req.body.cohortName.length > 32) {
    const name = req.body.cohortName.substring(0, 32);
    req.body.cohortName = name;
  }

  if (req.body.cohortDesc.length > 128) {
    const desc = req.body.cohortDesc.substring(0, 128);
    req.body.cohortDesc = desc;
  }

  let isPrivate = 0;
  if (req.body.isPrivate) {
    isPrivate = 1;
  }
  const data = [req.body.cohortName, req.body.cohortDesc, isPrivate];

  if (req.params.cohortId) {
    // Check if cohort exists, if so then update and return
    const cohortId = parseInt(req.params.cohortId);
    const checkRank = await db.checkRegistration(cohortId, req.user.id);
    if (checkRank.context.rank === 'owner') {
      data.push(cohortId);
      const cohortResponse = await db.updateCohort(data);
      if (cohortResponse.failed) {
        res.sendStatus(500);
      } else {
        res.sendStatus(204);
      }
    } else {
      res.sendStatus(404);
    }
    return;
  }

  // Create cohort
  const response = await db.createCohort(data);
  if (response.failed) {
    res.sendStatus(500);
    return;
  }
  // Add current user to cohort registration
  const registration = await insertRegistration(req.user.id, response.context.id, 'owner');
  if (registration.failed) {
    res.sendStatus(500);
    return;
  }

  res.sendStatus(204);
};

exports.getCohort = async function (req, res) {
  const cohortId = parseInt(req.params.cohortId);

  // If cohortId wrong type, return 400
  if (isNaN(cohortId)) {
    res.sendStatus(400);
    return;
  }

  // Get group from database
  const response = await db.getRecordByPrimaryKey('cohort', cohortId);

  // If group not found, return 404
  if (!response.context) {
    res.sendStatus(404);
    return;
  }
  // If group public
  if (!response.context.isPrivate) {
    // If group found, return 200
    res.status(200).json({
      data: response.context,
    });
    return;
  }

  // If group is private and user not logged in, return 404
  if (!req.user) {
    res.sendStatus(404);
    return;
  }

  // If group private and user logged in, check registration
  const registrationResponse = await db.checkRegistration(cohortId, req.user.id);
  // If user not registered, return 404
  if (!registrationResponse.context) {
    res.sendStatus(404);
    return;
  }

  // If user registration found, return 200
  res.status(200).json({
    data: response.context,
  });
};

exports.getUserCohorts = async function (req, res) {
  const response = await db.getUserCohorts(req.user.id);
  if (response.failed) {
    res.sendStatus(500);
  } else {
    if (response.context.length === 0) {
      res.sendStatus(204);
    }
    res.status(200).json({
      data: response.context,
    });
  }
};

exports.searchCohorts = async function (req, res) {
  // Converting to upper case is somewhat irrelevant because SQLite is case-insensitive by default
  // However future additions might benefit
  const searchQuery = '%' + decodeURIComponent(req.params.query).toUpperCase() + '%';
  const response = await db.searchCohorts(searchQuery, req.user.id);
  if (response.failed) {
    console.log(response);
    res.sendStatus(500);
    return;
  }
  if (response.context.length === 0) {
    res.sendStatus(204);
    return;
  }
  res.status(200).json({
    results: response.context,
  });
};


// -- REGISTRATION FUNCTIONS --
exports.registerUser = async function (req, res) {
  // If cohortId invalid, return 400
  const cohortId = parseInt(req.params.cohortId);
  if (isNaN(cohortId)) {
    res.sendStatus(400);
    return;
  }

  // Check if cohort is public or not
  const response = await db.getPublicCohort(cohortId);
  if (!response.context) {
    res.sendStatus(404);
    return;
  }
  // If public, register user
  const registerResponse = await insertRegistration(req.user.id, cohortId);
  if (registerResponse.failed) {
    res.sendStatus(500);
    return;
  }
  // Check if user has pending invite
  const checkInvite = await db.checkInvite(cohortId, req.user.id);
  // If something went wrong, log it
  if (checkInvite.failed) {
    res.sendStatus(500);
    return;
  }
  // If an invite was found
  if (checkInvite.context) {
    const inviteId = checkInvite.context.inviteId;
    const decline = await db.deleteInvite(inviteId);
    // If something went wrong, return 500
    if (decline.failed) {
      res.sendStatus(500);
      return;
    }
  }
  res.sendStatus(204);
};

exports.getRegistration = async function (req, res) {
  const cohortId = parseInt(req.params.cohortId);
  // If cohortId invalid, return 400
  if (isNaN(cohortId)) {
    res.sendStatus(400);
    return;
  }
  // Attempt to fetch registration
  const response = await db.checkRegistration(cohortId, req.user.id);
  if (response.failed) {
    console.log(response);
    res.sendStatus(500);
    return;
  }
  // If user not registered, return guest
  if (!response.context) {
    res.status(200).json({
      rank: 'guest',
    });
    return;
  }
  // Return user's rank
  res.status(200).json({
    rank: response.context.rank,
  });
};


// -- INVITE FUNCTIONS --
exports.inviteUsers = async function (req, res) {
  const cohortId = parseInt(req.params.cohortId);
  const validBody = (req.body.userIds && typeof req.body.userIds === 'string');
  // If request data invalid, return 400
  if (isNaN(cohortId) || !validBody) {
    res.sendStatus(400);
    return;
  }
  const checkRank = await db.checkRegistration(cohortId, req.user.id);
  if (!(checkRank.context.rank === 'owner')) { // || checkRank.context.rank === 'admin')) { -- Admin rank unused in current version
    res.sendStatus(404);
    return;
  }
  const idList = req.body.userIds.replace(/\s+/g, '').split(',');

  for (let i = 0; i < idList.length; i++) {
    const isUser = await db.getRecordByPrimaryKey('user', idList[i]);
    if (isUser.context) {
      // Check if invite already exists
      const inviteExists = await db.checkInvite(cohortId, idList[i]);
      // Check if user already registered with cohort
      const isRegistered = await db.checkRegistration(cohortId, idList[i]);
      if (!inviteExists.context && !isRegistered.context) {
        const response = await db.createInvite([cohortId, idList[i], '']);
        if (response.failed) {
          console.log(response);
        }
      }
    }
  }

  res.sendStatus(204);
};

exports.acceptInvite = async function (req, res) {
  // Get invite by id
  const inviteId = parseInt(req.params.inviteId);

  if (isNaN(inviteId)) {
    res.sendStatus(400);
    return;
  }

  const invite = await db.getRecordByPrimaryKey('invite', inviteId);

  // If invite not found with this user, return 404
  if (!invite.context || invite.context.userId !== req.user.id) {
    res.sendStatus(404);
    return;
  }

  // If invite belongs to user, add user registration
  const register = await insertRegistration(invite.context.userId, invite.context.cohortId);
  // If something went wrong, return 500
  if (register.failed) {
    res.sendStatus(500);
    return;
  }

  // If accepted, delete invite record
  const decline = await db.deleteInvite(inviteId);
  // If something went wrong, return 500
  if (decline.failed) {
    res.sendStatus(500);
    return;
  }

  // If success, return 204
  res.sendStatus(204);
};

exports.getInvites = async function (req, res) {
  const response = await db.getUserInvites(req.user.id);
  if (response.failed) {
    res.sendStatus(500);
    return;
  }
  if (response.context.length === 0) {
    res.sendStatus(204);
    return;
  }
  res.status(200).json({
    data: response.context,
  });
};

exports.searchInviteableUsers = async function (req, res) {
  const cohortId = parseInt(req.params.cohortId);
  if (isNaN(cohortId)) {
    res.sendStatus(400);
    return;
  }
  // Converting to upper case is somewhat irrelevant because SQLite is case-insensitive by default
  // However future additions might benefit
  const searchQuery = '%' + decodeURIComponent(req.params.query).toUpperCase() + '%';
  const response = await db.searchInviteableUsers(searchQuery, cohortId);
  if (response.failed || response.context.length === 0) {
    res.sendStatus(204);
    return;
  }
  res.status(200).json({
    results: response.context,
  });
};

exports.declineInvite = async function (req, res) {
  const inviteId = parseInt(req.params.inviteId);
  // If inviteId invalid, return 400
  if (isNaN(inviteId)) {
    res.sendStatus(400);
    return;
  }
  // Get invite by id
  const invite = await db.getRecordByPrimaryKey('invite', inviteId);

  // If invite not with this user, return 404
  if (!invite.context || invite.context.userId !== req.user.id) {
    res.sendStatus(404);
    return;
  }

  // If invite belongs to user, delete
  const decline = await db.deleteInvite(inviteId);
  // If something went wrong, return 500
  if (decline.failed) {
    res.sendStatus(500);
    return;
  }
  // If success, return 204
  res.sendStatus(204);
};


// -- POST FUNCTIONS -- For user posts, not routes using the POST method
exports.createPost = async function (req, res) {
  // If group ID invalid, return 404
  const cohortId = parseInt(req.params.cohortId);
  if (isNaN(cohortId)) {
    res.sendStatus(400);
    return;
  }

  // If no title or description, return 400
  if (!req.body.postTitle || !req.body.postDesc) {
    res.sendStatus(400);
    return;
  }
  if (req.body.postTitle === '' || req.body.postDesc === '') {
    res.sendStatus(400);
    return;
  }

  // Format data correctly
  if (req.body.postTitle.length > 128) {
    const title = req.body.postTitle.substring(0, 128);
    req.body.postTitle = title;
  }

  // If not registered with group, return 404
  const checkRank = await db.checkRegistration(cohortId, req.user.id);
  if (!checkRank.context) {
    res.sendStatus(404);
    return;
  }
  const registrationId = checkRank.context.registrationId;

  const fileString = await handleFileUpload(req.files);

  const criteriaData = JSON.parse(req.body.questions);

  // List to store Ids to put in criteria record
  const questionIds = [];
  const savingIDs = [];
  // Get question data
  for (let i = 0; i < criteriaData.questions.length; i++) {
    const currentQuestion = criteriaData.questions[i];
    const data = [];
    data.push(currentQuestion.question);
    data.push(currentQuestion.type);

    if (currentQuestion.type === 'text') {
      // If free text, no answers needed
      data.push(null);
    } else if (currentQuestion.type === 'radio' || currentQuestion.type === 'checkbox') {
      // If multiple choice, add answer strings
      const answerString = answerListToString(currentQuestion.answers);
      answerStringToList(answerString);
      data.push(answerString);
    } else {
      // If type not valid, return 400
      res.sendStatus(400);
      return;
    }

    // Insert question
    const questionCreation = await db.createQuestion(data);
    if (questionCreation.failed) {
      res.sendStatus(500);
      return;
    }
    // Add ID to list
    questionIds.push(questionCreation.context.id);

    // If question being saved, then add ID to list
    if (currentQuestion.save) {
      savingIDs.push(questionCreation.context.id);
    }
  }

  // Add saved questions to profile
  const savingString = savingIDs.toString();
  const save = await db.addSavedQuestions(req.user.id, savingString);
  if (save.failed) {
    console.log(save);
  }

  // Insert criteria record
  const questionIdString = questionIds.toString();
  const criteriaCreation = await db.createCriteria([questionIdString]);
  if (criteriaCreation.failed) {
    res.sendStatus(500);
    return;
  }
  const criteriaId = criteriaCreation.context.id;

  // Insert post data
  const datum = new Date();
  const unixTime = datum.getTime();
  const data = [registrationId, criteriaId, req.body.postTitle, req.body.postDesc, fileString, unixTime];

  const postCreation = await db.createPost(data);
  if (postCreation.failed) {
    res.sendStatus(500);
    return;
  }

  res.sendStatus(201);
};

async function handleFileUpload(files) {
  // Handle document upload
  const newFilenames = [];

  // Loop through every file
  for (const file of files) {
    // Get the file extension and add it to the random file name
    const fileExtList = file.originalname.split('.');
    const fileExt = fileExtList[fileExtList.length - 1];
    const newFilename = file.filename + '.' + fileExt;
    // Move file and rename it with extension
    await renameAsync(file.path, config.docStore + newFilename);
    // Add file to list
    newFilenames.push(newFilename);
  }

  // Return file list as string to store in database
  return newFilenames.toString();
}

exports.getPost = async function (req, res) {
  // Check postId is valid
  const postId = parseInt(req.params.postId);
  if (isNaN(postId)) {
    res.sendStatus(400);
    return;
  }

  const postRetrieval = await db.getPost(postId);
  if (postRetrieval.failed || !postRetrieval.context) {
    res.sendStatus(404);
    return;
  }

  const getPublic = await db.getPublicCohort(postRetrieval.context.cohortId);
  // If cohort private
  if (!getPublic.context) {
    // If not logged in, return 404
    if (!req.user) {
      res.sendStatus(404);
      return;
    }
    // If not registered with group, return 404
    const checkRank = await db.checkRegistration(postRetrieval.context.cohortId, req.user.id);
    if (!checkRank.context) {
      res.sendStatus(404);
      return;
    }
  }

  // If all good, send post data
  res.status(200).json({
    data: postRetrieval.context,
  });
};

exports.getPosts = async function (req, res) {
  // If attempting to get own posts but not logged in, return 404;
  if (!req.params.cohortId && !req.user) {
    res.sendStatus(400);
    return;
  }
  // If requesting group posts
  if (req.params.cohortId) {
    const cohortId = parseInt(req.params.cohortId);
    // Check if group is public
    const getPublic = await db.getPublicCohort(cohortId);
    if (!getPublic.context) {
      // Check if user is registered
      if (!req.user) {
        res.sendStatus(404);
        return;
      }
      // If not registered with group, return 404
      const checkRank = await db.checkRegistration(cohortId, req.user.id);
      if (!checkRank.context) {
        res.sendStatus(404);
        return;
      }
    }
    // Group is either public, or user is member of group, so display posts
    const posts = await db.getCohortPosts(cohortId);
    if (posts.failed) {
      res.sendStatus(500);
      return;
    }
    // If no posts found, return 204
    if (posts.context.length === 0) {
      res.sendStatus(204);
      return;
    }
    // Return posts
    res.status(200).json({
      data: posts.context,
    });
  } else {
    // If requesting own posts
    const posts = await db.getUserPosts(req.user.id);
    if (posts.failed) {
      res.sendStatus(500);
      return;
    }
    // If no posts found, return 204
    if (posts.context.length === 0) {
      res.sendStatus(204);
      return;
    }
    // Return posts
    res.status(200).json({
      data: posts.context,
    });
  }
};

exports.deletePost = async function (req, res) {
  const postId = parseInt(req.params.postId);
  if (isNaN(postId)) {
    res.sendStatus(400);
    return;
  }

  // If post doesn't exist, return 404
  const postRetrieval = await db.getPost(postId);
  if (postRetrieval.failed || !postRetrieval.context) {
    res.sendStatus(404);
    return;
  }

  // Can only delete your own post
  if (postRetrieval.context.userId !== req.user.id) {
    res.sendStatus(404);
    return;
  }

  // Delete post
  const delResponse = await db.deletePost(postId);
  if (delResponse.failed) {
    res.sendStatus(500);
    return;
  }


  // Mark files for deletion
  const fileList = postRetrieval.context.files.split(',');
  for (let i = 0; i < fileList.length; i++) {
    fileList[i] = config.docPath + fileList[i];
  }

  fs.appendFile(config.redundants, fileList.toString() + ',', (err) => {
    if (err) throw err;
  });


  // Delete criteria
  const criteriaRetrieval = await db.getRecordByPrimaryKey('criteria', postRetrieval.context.criteriaId);
  db.deleteCriteria(postRetrieval.context.criteriaId);

  // Delete question responses
  const questionList = criteriaRetrieval.context.questions.split(',');
  for (let i = 0; i < questionList.length; i++) {
    db.deleteResponses(questionList[i]);
  }

  res.sendStatus(204);
};


// -- CRITERIA FUNCTIONS --
exports.getCriteria = async function (req, res) {
  const criteriaId = parseInt(req.params.criteriaId);
  if (isNaN(criteriaId)) {
    res.sendStatus(400);
    return;
  }

  // Retrieve questions
  const criteriaRetrieval = await db.getRecordByPrimaryKey('criteria', criteriaId);
  if (criteriaRetrieval.failed) {
    res.sendStatus(500);
    return;
  }
  // If not found, return 404
  if (!criteriaRetrieval.context) {
    res.sendStatus(404);
    return;
  }

  // Get the questions from the criteria object
  const questionList = criteriaRetrieval.context.questions.split(',');
  const questions = [];
  for (let i = 0; i < questionList.length; i++) {
    const currentQuestion = parseInt(questionList[i]);
    // Retrieve the question from the database
    const questionRetrieval = await db.getRecordByPrimaryKey('question', currentQuestion);
    if (questionRetrieval.failed) {
      res.sendStatus(500);
      return;
    }
    // Create a JSON object
    const questionObj = questionRetrieval.context;
    if (!questionObj) {
      continue;
    }
    if (questionObj.answers) {
      const answers = answerStringToList(questionObj.answers);
      questionObj.answers = answers;
    }
    // Add to main object
    questions.push(questionObj);
  }

  // If no questions, return 204
  if (questions.length === 0) {
    res.sendStatus(204);
    return;
  }

  // Return data to client
  res.status(200).json({
    data: questions,
  });
};

exports.getSavedQuestions = async function (req, res) {
  // Retrieve saved questions from user table
  const questionStringRetrieval = await db.getSavedQuestions(req.user.id);
  if (questionStringRetrieval.failed) {
    console.log(questionStringRetrieval);
    res.sendStatus(500);
    return;
  }
  // Convert question ids into list
  const questionList = questionStringRetrieval.context.savedQuestions.split(',');
  let questionCount = 0;
  for (let i = 0; i < questionList.length; i++) {
    if (questionList[i] !== '') questionCount++;
  }
  // If no questionIds in list, return 204
  if (questionCount === 0) {
    res.sendStatus(204);
    return;
  }

  const returnList = [];
  for (let i = 0; i < questionList.length; i++) {
    const currentId = questionList[i];
    // If current ID is blank, skip
    // (the last entry will always be blank because of the comma at the end of the string)
    if (currentId === '') {
      continue;
    }
    const question = await db.getRecordByPrimaryKey('question', currentId);
    // If retrieval failed, skip to next question
    if (question.failed) {
      continue;
    }
    // Create question object
    const questionObj = {
      questionContent: question.context.questionContent,
      type: question.context.type,
    };
    // Get answers for question if applicable
    if (questionObj.type !== 'text') {
      questionObj.answers = answerStringToList(question.context.answers);
    }
    // Add question to list
    returnList.push(questionObj);
  }
  res.status(200).json({
    data: returnList,
  });
};


// -- RESPONSE FUNCTIONS --
exports.createResponse = async function (req, res) {
  const postId = parseInt(req.params.postId);
  if (isNaN(postId)) {
    res.sendStatus(400);
    return;
  }

  // If post doesn't exist, return 404
  const postRetrieval = await db.getPost(postId);
  if (postRetrieval.failed || !postRetrieval.context) {
    res.sendStatus(404);
    return;
  }

  // Can't leave feedback on your own work
  if (postRetrieval.context.userId === req.user.id) {
    res.sendStatus(404);
    return;
  }

  const getPublic = await db.getPublicCohort(postRetrieval.context.cohortId);
  // If cohort private
  if (!getPublic.context) {
    // If not logged in, return 404
    if (!req.user) {
      res.sendStatus(404);
      return;
    }
    // If not registered with group, return 404
    const checkRank = await db.checkRegistration(postRetrieval.context.cohortId, req.user.id);
    if (!checkRank.context) {
      res.sendStatus(404);
      return;
    }
  }

  // Get Criteria record
  const criteriaRetrieval = await db.getRecordByPrimaryKey('criteria', postRetrieval.context.criteriaId);
  if (criteriaRetrieval.failed || !criteriaRetrieval.context) {
    res.sendStatus(404);
    return;
  }

  // Get questions from criteria
  const questionList = criteriaRetrieval.context.questions.split(',');


  // Check values in FormData
  const questionNumList = [];
  const answers = [];
  const body = Object.keys(req.body);
  if (body.length === 0) {
    res.sendStatus(400);
    return;
  }
  for (let i = 0; i < body.length; i++) {
    console.log(body[i] + ': ' + req.body[body[i]]);
    // Get question number
    const questionNum = body[i].match(/\d+/)[0];
    // If this question doesn't already have an answer, create a new reference in list
    if (!questionNumList.includes(questionNum)) {
      questionNumList.push(questionNum);
    }

    const matchList = body[i].match(/\d+/g);
    // Was it a checkbox question
    if (matchList.length > 1) {
      // Get the index of the question
      const indexPos = questionNumList.indexOf(questionNum);
      // Check if the question has an answer already
      if (answers.length < indexPos + 1) {
        // If not, then create a list object for it
        answers.push([]);
      }
      // Else append to pre-existing list
      answers[indexPos].push(matchList[1]);
    } else {
      // Push answer
      answers.push(req.body[body[i]]);
    }
  }

  // Loop through all questions
  for (let i = 0; i < questionNumList.length; i++) {
    // Get current question
    const questionId = questionList[parseInt(questionNumList[i])];
    const currentQuestion = await db.getRecordByPrimaryKey('question', questionId);
    if (currentQuestion.failed || !currentQuestion.context) {
      res.sendStatus(404);
      return;
    }

    // If question has multiple answers, convert indexes to actual answers
    // Checkboxes can have more than one answer in one response
    // So type is array ('object') rather than 'string'
    if (typeof answers[i] !== 'string') {
      if (currentQuestion.context.type !== 'checkbox') {
        res.sendStatus(400);
        return;
      }

      // Get answers from question
      const answerList = answerStringToList(currentQuestion.context.answers);
      // Convert indexes to answers
      for (let j = 0; j < answers[i].length; j++) {
        answers[i][j] = answerList[parseInt(answers[i][j])];
      }

      // Convert answers to single string
      answers[i] = answerListToString(answers[i]);
    }

    // If answer is blank, skip
    if (answers[i].length !== 0) {
      // Check if response already exists for question
      const checkResponse = await db.getUserResponse(req.user.id, questionId);
      if (checkResponse.failed) {
        res.sendStatus(500);
        return;
      }
      if (checkResponse.context) {
        const responseId = checkResponse.context.responseId;
        // Update response
        const updateResponse = await db.updateResponse(responseId, answers[i]);
        if (updateResponse.failed) {
          res.sendStatus(500);
          return;
        }
      } else {
        // Create new response
        const data = [req.user.id, questionId, answers[i]];
        const newResponse = await db.createResponse(data);
        if (newResponse.failed) {
          console.log(newResponse.context);
          res.sendStatus(500);
          return;
        }
      }
    }
  }

  res.sendStatus(201);
};

exports.getResponseStats = async function (req, res) {
  const postId = parseInt(req.params.postId);
  if (isNaN(postId)) {
    res.sendStatus(400);
    return;
  }

  // If post doesn't exist, return 404
  const postRetrieval = await db.getPost(postId);
  if (postRetrieval.failed || !postRetrieval.context) {
    res.sendStatus(404);
    return;
  }

  // Can only view stats on your own post
  if (postRetrieval.context.userId !== req.user.id) {
    res.sendStatus(404);
    return;
  }

  // Retrieve criteria info
  const criteriaId = postRetrieval.context.criteriaId;
  const criteriaRetrieval = await db.getRecordByPrimaryKey('criteria', criteriaId);
  if (criteriaRetrieval.failed) {
    res.sendStatus(404);
    return;
  }

  // Get stats for each question
  const questionList = criteriaRetrieval.context.questions.split(',');
  const data = [];
  for (let i = 0; i < questionList.length; i++) {
    const questionId = questionList[i];
    const questionStats = await getQuestionStats(questionId);
    data.push(questionStats);
  }

  // Return data
  res.status(200).json({
    data: data,
  });
};

async function getQuestionStats(questionId) {
  // Retrieve question
  const questionRetrieval = await db.getRecordByPrimaryKey('question', questionId);
  if (!questionRetrieval.context) {
    return [];
  }
  const questionStats = {
    question: questionRetrieval.context.questionContent,
    type: questionRetrieval.context.type,
  };

  if (questionRetrieval.context.type === 'text') {
    questionStats.responses = [];
    // Retrieve all responses to question
    const responses = await db.getAllResponses(questionId);
    for (let i = 0; i < responses.context.length; i++) {
      questionStats.responses.push(responses.context[i].answer);
    }
  } else {
    // Retrieve totals for each answer
    // Get all possible answers
    const answers = questionRetrieval.context.answers;
    const answerList = answerStringToList(answers);
    questionStats.answers = answerList;
    questionStats.totals = [];
    for (let i = 0; i < answerList.length; i++) {
      const currentAnswer = answerList[i];
      let countResponse;
      // If checkbox type, then regex is needed to match answer strings
      if (questionRetrieval.context.type === 'checkbox') {
        const formattedAnswer = currentAnswer + ' ';
        // Create list for regex strings
        const sqliteRegexList = [];
        sqliteRegexList.push(`${formattedAnswer},%`); // Starts with
        sqliteRegexList.push(`% ,${formattedAnswer},%`); // Contains
        sqliteRegexList.push(`% ,${formattedAnswer}`); // Ends with
        const data = [questionId, sqliteRegexList[0], sqliteRegexList[1], sqliteRegexList[2], formattedAnswer];
        countResponse = await db.getCheckboxResponseCount(data);
      } else {
        // If radio type, then just match answer
        countResponse = await db.getRadioResponseCount(questionId, currentAnswer);
      }
      // Get total from response
      const totalCount = countResponse.context.total;
      questionStats.totals.push(totalCount);
    }
  }
  return questionStats;
}


// -- FILE FUNCTIONS --
exports.getFile = function (req, res) {
  const id = req.params.fileId;
  const file = `${config.docStore}${id}`;

  // Check if file exists
  fs.access(file, fs.F_OK, (err) => {
    if (err) {
      // If doesn't exists, return 404
      res.sendStatus(404);
      return;
    }
    // Else send file
    res.sendFile(file);
  });
};

exports.getImage = function (req, res) {
  const id = req.params.imageId;
  const image = `${config.imageStore}${id}`;

  // Check if image exists
  fs.access(image, fs.F_OK, (err) => {
    if (err) {
      // If doesn't exists, return 404
      res.sendStatus(404);
      return;
    }
    // Else send image
    res.sendFile(image);
  });
};

exports.downloadFile = function (req, res) {
  const id = req.params.fileId;
  const file = `${config.docStore}${id}`;

  // Check if file exists
  fs.access(file, fs.F_OK, (err) => {
    if (err) {
      // If doesn't exists, return 404
      res.sendStatus(404);
      return;
    }
    // Else send file
    res.download(file);
  });
};

exports.downloadAll = async function (req, res) {
  const postId = parseInt(req.params.postId);
  if (isNaN(postId)) {
    res.sendStatus(400);
    return;
  }
  // Get files from post
  const postRetrieval = await db.getPost(postId);
  if (postRetrieval.failed) { // || !postRetrieval.context) {
    res.sendStatus(500);
    return;
  }

  if (!postRetrieval.context) {
    res.sendStatus(404);
    return;
  }

  if (postRetrieval.context.files === '') {
    res.sendStatus(204);
    return;
  }

  const files = postRetrieval.context.files.split(',');
  const fileObjs = [];
  files.forEach(file => {
    const object = {
      path: config.docStore + file,
      name: file,
    };
    fileObjs.push(object);
  });
  const datum = new Date();
  const unixTime = datum.getTime();
  res.zip(fileObjs, `LPRS-${postId}_${unixTime}.zip`);
};


// -- MISCELLANEOUS FUNCTIONS --
exports.checkUniqueUsername = async function (req, res) {
  // Get current user profile to compare username
  const user = await db.getRecordByPrimaryKey('user', req.user.id);
  if (user.failed) {
    res.sendStatus(500);
    return;
  }
  // If username is owned by current user, then return 200
  if (user.context.username === req.params.username) {
    res.status(200).json({
      unique: true,
    });
    return;
  }
  const isUnique = await checkUsername(req.params.username);
  res.status(200).json({
    unique: isUnique,
  });
};

async function checkUsername(username) {
  const lookup = await db.checkUsername(username);
  if (lookup.context.total === 0) {
    return true;
  }
  return false;
}

function answerListToString(subjectList) {
  // Encode answer strings, then comma separate

  const newList = [];

  subjectList.forEach(subjectString => {
    // I need to make sure the last character in each string isn't a backslash
    subjectString += ' ';
    // Storing separate strings as comma separated in my database means that
    // I need a way to separate the commas in the string/s from the comma separations
    const newString = subjectString.replace(/,/g, '/,');

    newList.push(newString);
  });

  return newList.toString();
}

function answerStringToList(subjectString) {
  // Remove whitespace from end of string
  subjectString = subjectString.replace(/\s+$/, '');
  // Convert string to list
  const subjectList = subjectString.split(' ,');

  const newList = [];
  // Put all commas back where they should be
  subjectList.forEach(item => {
    const newString = item.replace(/\/,/g, ',');
    newList.push(newString);
  });

  return newList;
}

async function insertRegistration(userId, cohortId, rank = 'member') {
  const data = [userId, cohortId, rank];
  const response = await db.createRegistration(data);
  return response;
}

exports.clearUnused = function () {
  // I considered using fs.readdir to get all the saved files, then cycle through each one and check if it appears in a database post
  // However I changed my mind and took this following approach because it felt like it would scale better to a bigger system
  fs.readFile(config.redundants, 'utf8', (err, data) => {
    if (!err) {
      const failedUnlinks = [];
      // Clear file
      fs.writeFile(config.redundants, '', (err) => {
        if (err) throw err;
      });
      // Get individual file names
      const fileList = data.split(',');
      // Unlink all redundant files
      for (let i = 0; i < fileList.length; i++) {
        const currentFile = fileList[i];
        // If file string is blank, skip
        if (currentFile.length === 0) {
          continue;
        }
        // Attempt to unlink
        try {
          fs.unlinkSync(config.root + currentFile);
        } catch (e) {
          // If failed, add file back to list
          failedUnlinks.push(currentFile + ',');
          continue;
        }
      }
      // Convert file list to string
      const failedUnlinksStr = failedUnlinks.toString();
      const finalString = failedUnlinksStr.replace(',,', ',');
      // Put filenames back into redundants file
      fs.appendFile(config.redundants, finalString, (err) => {
        if (err) throw err;
      });
    } else {
      console.log('Err:', err);
    }
  });
};
