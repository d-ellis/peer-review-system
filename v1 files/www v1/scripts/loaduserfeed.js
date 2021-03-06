/* global getElementForFile gapi, userProfile */

const newsFeedContainer = document.getElementById('newsFeed');

const newPostFiles = [];
let currentOffset = 0;

async function getNextPosts(offset) {
  // Get posts from server
  const idToken = gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token;

  const response = await fetch(`/posts/${offset}`, {
    headers: {
      Authorization: 'Bearer ' + idToken,
    },
    credentials: 'same-origin',
  });
  // If no posts retrieved, return empty list
  if (!response.ok || response.status === 204) {
    return [];
  }
  // Get posts from response and return them
  const resData = await response.json();
  currentOffset += 10;
  const listOfPosts = resData.data;
  return listOfPosts;
}

async function appendPosts(listOfPosts) {
  // Was using forEach(...), but it had issues with async await
  for (let i = 0; i < listOfPosts.length; i++) {
    try {
      const post = listOfPosts[i];
      const newContainer = document.createElement('div');
      newContainer.className = 'news-item feature-element';
      newContainer.setAttribute('post', post.id);

      // Add title
      const newTitle = document.createElement('h1');
      const newTitleLink = document.createElement('a');
      newTitleLink.href = `/post?${post.id}`;
      newTitleLink.textContent = post.title;
      newTitle.appendChild(newTitleLink);

      // Container for group and author
      const postedContainer = document.createElement('h4');
      postedContainer.classList.add('poster-info-header');
      // Add group link
      const groupLink = document.createElement('a');
      groupLink.classList.add('post-link');
      groupLink.href = '/group?' + post.groupId;
      // Have group picture contained in link
      const groupImage = document.createElement('img');
      groupImage.classList.add('group-pic');
      groupImage.src = '/profile-pic/g/' + post.image;
      groupLink.appendChild(groupImage);
      // Add group name to link
      const groupName = document.createElement('span');
      groupName.textContent = post.group;
      groupLink.appendChild(groupName);
      postedContainer.appendChild(groupLink);
      // Non-link text to connect group and author
      const authorConnector = document.createElement('span');
      authorConnector.textContent = ' | By ';
      postedContainer.appendChild(authorConnector);
      // Add author name with link
      const authorLink = document.createElement('a');
      authorLink.classList.add('post-link');
      authorLink.href = '/profile?' + post.authorId;
      authorLink.textContent = post.author;
      postedContainer.appendChild(authorLink);

      // Add description
      const newDesc = document.createElement('p');
      newDesc.classList.add('post-description');
      newDesc.innerText = post.caption;


      newContainer.appendChild(postedContainer);
      newContainer.appendChild(newTitle);
      newContainer.appendChild(newDesc);
      if (post.files > 0) {
        const documentContainer = document.createElement('div');
        documentContainer.classList.add('file-preview-container');
        newContainer.appendChild(documentContainer);
        for (let i = 0; i < post.files; i++) {
          const innerDoc = await getElementForFile(post.id, i);
          documentContainer.appendChild(innerDoc);
        }
      }
      newsFeedContainer.appendChild(newContainer);
    } catch (e) {
      console.log(e);
    }
  }
}

async function initPage() {
  if (!userProfile) {
    document.getElementById('newPostContainer').remove();
  }
  appendPosts(await getNextPosts(currentOffset));
  // Remove link but make it scroll user to top of page
  document.getElementById('feedButton').parentElement.removeAttribute('href');
  document.getElementById('feedButton').addEventListener('click', () => {
    window.scrollTo(0, 0);
  });
  resetFileInput();
}
/* exported initPage */

function handleFileSelect(e) {
  // Get the file and read it so it can be displayed
  const file = e.target.files[0];
  const fileSizeInMB = file.size / (1024 * 1024);
  if (fileSizeInMB >= 30) {
    alert('Max file size is 30MB!');
    return;
  }
  const reader = new FileReader();
  reader.readAsDataURL(file);

  reader.onload = function () {
    /*
      When the reader has loaded the file,
      attempt to append the file to the list and display it on screen
    */
    try {
      createNewFileHolder(reader);
      newPostFiles.push(file);
      checkReadyFileCount();
    } catch (e) {
      console.log(e);
    }
    resetFileInput();
  };
}

function createNewFileHolder(file) {
  const mainContainer = document.getElementById('filesToUpload');
  const itemContainer = document.createElement('div');
  itemContainer.classList.add('preview-container');
  // Display document
  const item = document.createElement('embed');
  item.classList.add('file-container', 'preview-file');
  item.src = file.result;
  itemContainer.appendChild(item);
  // Create delete button for file
  const deleteButton = document.createElement('div');
  deleteButton.classList.add('button', 'file-delete-button');
  deleteButton.textContent = 'Delete';
  itemContainer.appendChild(deleteButton);
  mainContainer.appendChild(itemContainer);

  const currentFileNum = newPostFiles.length;
  deleteButton.addEventListener('click', (e) => {
    removeFileFromPost(e.target, currentFileNum);
  });
}

document.getElementById('newPostSubmit').addEventListener('click', submitPost);

// Prevent new line character from being added to title
document.getElementById('newPostTitle').addEventListener('keypress', (e) => {
  if (e.which === 13) {
    e.preventDefault();
  }
});

async function submitPost() {
  // Submit the post
  const idToken = gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token;
  // Add all files to the FormData
  const fileData = new FormData();
  newPostFiles.forEach(file => {
    if (file) {
      fileData.append('document', file);
    }
  });

  let fileListString = '';
  // If any files were included, post them
  if (fileData.get('document')) {
    // Send Request
    const response = await fetch('/docs/', {
      headers: {
        Authorization: 'Bearer ' + idToken,
      },
      method: 'POST',
      credentials: 'same-origin',
      body: fileData,
    });

    const resData = await response.json();

    fileListString = resData.data.toString();
  }

  // Create new post here
  const data = {
    title: document.getElementById('newPostTitle').textContent,
    caption: document.getElementById('newPostDesc').innerText,
    groupId: document.getElementById('newPostGroup').value,
    files: fileListString,
  };
  if (!(data.title && data.caption && data.groupId)) {
    return;
  }

  const response = await fetch('/post/', {
    headers: {
      'Authorization': 'Bearer ' + idToken,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    credentials: 'same-origin',
    body: JSON.stringify(data),
  });

  const resData = await response.json();
  console.log(resData);

  // Reset the new post container
  document.getElementById('newPostTitle').textContent = '';
  document.getElementById('newPostDesc').textContent = '';

  const container = document.getElementById('filesToUpload');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  location.reload();
  // newPostFiles = [];
  // checkReadyFileCount();
}

// Check how many files are prepped to be posted so a limit can be enforced
function checkReadyFileCount() {
  const container = document.getElementById('filesToUpload');
  // Show or hide new file upload button
  if (container.childNodes.length >= 5) {
    document.getElementById('addNewFile').hidden = true;
  } else {
    document.getElementById('addNewFile').hidden = false;
  }
}

function removeFileFromPost(target, fileNum) {
  target.parentElement.remove();
  newPostFiles[fileNum] = undefined;
  checkReadyFileCount();
}

function resetFileInput() {
  // Delete file input if it exists
  let fileUploader = document.getElementById('fileInput');
  if (fileUploader) {
    fileUploader.remove();
  }

  // Create new file input
  const html = "<input id='fileInput' type='file' accept='image/*, audio/*, .pdf' hidden>";
  document.getElementById('newPostFileContainer').insertAdjacentHTML('afterbegin', html);

  // Add event listener again
  fileUploader = document.getElementById('fileInput');
  fileUploader.addEventListener('change', handleFileSelect);
}
