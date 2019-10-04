/*
 * This file is part of Search NEU and licensed under AGPL3.
 * See the license file in the root folder for details.
 */

import randomstring from 'randomstring';

import _ from 'lodash';
import request from './request';
import macros from './macros';
import Keys from '../../common/Keys';


// Manages user data in the frontend
// Downloads the data from the server when the page first starts

// Eventually, this can be used to get the current user data from the server.

class User {
  constructor() {
    // Promise to keep track of user data.
    this.userDataPromise = null;

    // downloads the user data immediately
    this.downloadUserData();

    // holds all of the callbacks necessary for the fuuttuurree
    this.callBack = [];
  }

  // Downloads the user data from the server.
  // Send the loginKey and the facebookMessengerId (if we have it).
  // Save the facebookMessengerId when the server responds (the server can respond to this request a lot faster when given the facebookMessengerId).
  async downloadUserData() {
    // User has not logged in before, don't bother making the request
    if (!this.hasLoggedInBefore()) {
      return;
    }

    const body = {
      loginKey: this.getLoginKey(),
    };

    // If we have sender id, send that up too
    // (will make the server respond faster)
    if (window.localStorage.senderId) {
      body.senderId = window.localStorage.senderId;
    }

    macros.log('data going to the backend is', body);
    const response = await request.post({ //eslint-disable-line no-await-in-loop
      url: '/getUserData',
      body: body,
    });

    // If error, delete local invalid data.
    if (response.error) {
      const d = new Date();
      macros.log('Data in localStorage is invalid, deleting', d.toUTCString());
      this.logOut();
      return;
    }

    this.user = response.user;

    // Keep track of the sender id too.
    window.localStorage.senderId = response.user.facebookMessengerId;

    for (const callback of this.callBack) {
      callback();
    }

    macros.log('got user data', this.user);
  }

  // String -> Object
  // Sets up a body to send data to the backend
  async setupSendingData(data) {
    // User has not logged in before, don't bother making the request
    if (!this.hasLoggedInBefore()) {
      return null;
    }

    macros.log('sending.... ', this.user);
    if (!this.user) {
      await this.downloadUserData();
    }

    const body = {
      loginKey: this.getLoginKey(),
    };

    body.info = data;

    // If we have sender id, send that up too
    // (will make the server respond faster)
    if (window.localStorage.senderId) {
      body.senderId = window.localStorage.senderId;
    }

    return body;
  }

  // Response ->
  // Handles post-request operations, mostly calling callbacks
  async afterSendingData(response) {
    // If error, log it
    if (response.error) {
      macros.log('something went wrong sending data');
      return;
    }

    // calls callbacks to ensure the frontend is updated
    for (const callback of this.callBack) {
      callback();
    }

    macros.log('sending success');
  }

  // Revokes the loginKey and user user-specific data
  logOut() {
    delete window.localStorage.loginkey;
    delete window.localStorage.senderId;
  }

  // Return if the user has logged in before.
  // This doesn't mean they are currently logged in, it just means they might be logged in.
  // and we need to hit the server and check.
  hasLoggedInBefore() {
    return !!window.localStorage.loginKey;
  }

  // gets a user's (as in browser) loginKey, or generates one if it doesn't exist yet
  getLoginKey() {
    let loginKey = window.localStorage.loginKey;

    // Init the loginKey if it dosen't exist
    if (!loginKey) {
      loginKey = randomstring.generate(100);
      window.localStorage.loginKey = loginKey;
    }

    return loginKey;
  }

  // checks if the user already has the section in it
  hasSectionAlready(sectionHash) {
    if (this.user) {
      return this.user.watchingSections.includes(sectionHash);
    }
    return false;
  }

  // checks if the user already has the class in it
  hasClassAlready(classHash) {
    if (this.user) {
      return this.user.watchingClasses.includes(classHash);
    }
    return false;
  }

  // removes a section from a user, as well as the class if no more sections are tracked
  // in that class
  async removeSection(section) {
    if (!this.user) {
      macros.error('no user for removal?');
      return;
    }


    const sectionHash = Keys.getSectionHash(section);

    if (this.user.watchingSections.includes(sectionHash)) {
      _.pull(this.user.watchingSections, sectionHash);


      const classInfo = {
        host: section.host,
        termId: section.termId,
        subject: section.subject,
        classId: section.classId,
      };
      const classHash = Keys.getClassHash(classInfo);

      let acc = false;
      for (let i = 0; i < this.user.watchingSections.length; i++) {
        acc = acc || this.user.watchingSections[i].includes(classHash);
      }

      if (!acc) {
        _.pull(this.user.watchingClasses, classHash);
      }

      const body = await this.setupSendingData(sectionHash);
      body.classHash = classHash;
      body.sectionInfo = section;
      body.classInfo = classInfo;

      const response = await request.post({
        url: '/removeSection',
        body: body,
      });

      this.afterSendingData(response);
    } else {
      macros.error("removed section that doesn't exist on user?", section, this.user);
    }
  }

  // enrolls a user in a section of a class
  async enrollSection(section) {
    if (!this.user) {
      macros.error('no user for addition?');
      return;
    }

    const sectionHash = Keys.getSectionHash(section);

    if (this.user.watchingSections.includes(sectionHash)) {
      macros.error('user already watching section?', section, this.user);
    }

    this.user.watchingSections.push(Keys.getSectionHash(section));

    const classHash = Keys.getClassHash({
      host: section.host,
      termId: section.termId,
      subject: section.subject,
      classId: section.classId,
    });

    if (!this.user.watchingClasses.includes(classHash)) {
      await this.addClass({
        host: section.host,
        termId: section.termId,
        subject: section.subject,
        classId: section.classId,
      });
    }

    macros.log('user has been enrolled in section', this.user);


    // now send the data
    const body = await this.setupSendingData(sectionHash);
    body.sectionInfo = section;

    const response = await request.post({
      url: '/addSection',
      body: body,
    });

    this.afterSendingData(response);
  }

  // registers a callback to go on the list of callbacks for a user.
  registerCallback(theCallback) {
    this.callBack.push(theCallback);
  }

  // gets rid of said callback, and all other variants of it.
  unregisterCallback(theCallback) {
    _.pull(this.callBack, theCallback);
  }

  // adds a class to a user
  async addClass(theClass) {
    if (!this.user) {
      macros.error('no user for addition?');
      return;
    }

    if (this.user.watchingClasses.includes(theClass)) {
      macros.error('user already watching class?', theClass, this.user);
      return;
    }

    this.user.watchingClasses.push(Keys.getClassHash(theClass));

    const body = await this.setupSendingData(Keys.getClassHash(theClass));
    body.classInfo = theClass;

    const response = await request.post({
      url:'/addClass',
      body: body,
    });

    this.afterSendingData(response);

    macros.log('class registered', this.user);
  }

  removeClass(theClass) {
    if (!this.user) {
      macros.error('no user for addition?');
      return;
    }

    if (!this.user.watchingClasses.includes(theClass)) {
      macros.error('user isn\'t watching class?', theClass, this.user);
      return;
    }

    _.pull(this.user.watchingClasses, Keys.getClassHash(theClass));

    macros.log('class removed', this.user);
  }
}


export default new User();
