/* eslint indent:0 no-console:0*/
'use strict';

import videojs from 'video.js';
import reqwest from 'reqwest';
import printf from 'printf';
import _ from 'lodash';

// Package scope references to plugin and player
let neon;
let player;

// Runtime options defaults
const defaults = {

    // Publisher options defaults
    publisher: {

        // Set in html
        // id: <your neon id>

        // Default attribute of video tag that identifies the video content
        // e.g., <video id="videojs" data-video-id=<video_id>/> uses data-video-id
        videoIdAttribute: 'data-video-id',
        // A regex to further extract the identifier
        videoIdAttributeRegex: null
    },

    // Tracking options
    tracking: {
        // Default Neon api endpoint
        neonApiUrl: 'http://tracker.neon-images.com/v2/track',

        // Neon thumbnail url to id resolver
        neonGetThumbnailIdUrl: 'http://i1.neon-images.com/v1/getthumbnailid/',

        // Resolution (in percent points) to track video play percent
        timeUpdateInterval: 25,

        // Assume this is a Brightcove videojs context
        type: 'BRIGHTCOVE',

        // Default events to remote log to Neon
        events: [
            'imageLoad',
            'imageView',
            'imageClick',
            'autoplay',
            'play',
            'adPlay',
            'timeUpdate'
        ],

        // How long in milliseconds to wait before sending first requests
        // via parent tracker
        waitForParentMillis: 5000
    },

    // Development options
    dev: {
        showConsoleLogging: false
    }
};

// Mapping of event type to Neon Api endpoint shorthand
const constants = {
    eventCodeMap: {
        imageLoad: 'il',
        imageView: 'iv',
        imageClick: 'ic',
        autoplay: 'vp',
        play: 'vp',
        adPlay: 'ap',
        timeUpdate: 'vvp'
    }
};

// Get the urlencoded location of the video player page
const _getPageUrl = () => {
    return encodeURIComponent(window.location.href);
};

// Get the urlencoded referrer of the video player page
const _getReferrer = () => {
    return encodeURIComponent(document.referrer);
};

// Get the basename of a url
// e.g., "http://example.com/dir/thispart.jpg?withparams" => "thispart"
const _basenameRegex = /^.*\/|\.[^.]*$/g;
const _getBasenameOf = (url) => {
    return url.replace(_basenameRegex, '');
};

// Calculate the percentage of the video played
const _getPercentPlayed = () => {
    const currentTime = Math.round(player.currentTime());
    const duration = Math.round(player.duration());

    return Math.round(currentTime / duration * 100);
};

// Determine if player is in ad-playing state by its element classes
// Regex from Google Analytics videojs plugin
// https://github.com/mickey/videojs-ga
const _adStateRegex = /(\s|^)vjs-ad-(playing|loading)(\s|$)/;
const _isInAdState = () => {
    return _adStateRegex.test(player.el().className);
};

// Specify valid keys for the api to guard against invalid request
const _trackerAllowedParams = [
    'a',
    'acount',
    'adelta',
    'aplay',
    'bn',
    'bns',
    'cts',
    'page',
    'pageid',
    'pcount',
    'playerId',
    'prcnt',
    'ref',
    'tai',
    'ttype',
    'vid'
];

// Calculate how many milliseconds until we stop waiting for the parent
// or return false.
const _getTimeoutForParent = () => {
    const timeout = neon.readyTime + neon.options.tracking.waitForParentMillis -
       (new Date()).getTime();

    if (timeout > 0) {
        return timeout;
    }
    return false;
};

const _getParentTracker = () => {
    if (window._neon) {
        neon.parentTracker = window._neon;
        return neon.parentTracker;
    }
    return null;
};

// Get the url without url parameters or hash
const _baseUrl = (url) => {
    const a = document.createElement('a');

    a.href = url;
    return printf('%s//%s%s', a.protocol, a.hostname, a.pathname);
};

const _trackerSendImageLoadedEventByUrl = (eventType, eventDetails, data) => {
    if (_getParentTracker()) {
        try {
            if (neon.options.dev.showConsoleLogging) {
                console.info(printf('via parent:%s', eventType), data);
            }
            return neon.parentTracker.TrackerEvents.sendImageLoadedEventByUrl(
                _baseUrl(eventDetails.images[0].url),
                eventDetails.images[0].width,
                eventDetails.images[0].height);
        } catch (err) {
            console.error('Fail to send event via parent tracker', err, eventType, data);
            return false;
        }
    }
    // Retry after timeout
    const timeout = _getTimeoutForParent();

    if (timeout) {
        setTimeout(_sendToTracker, timeout, eventType, eventDetails);
        return true;
    }
    return false;
};

const _trackerSendImageVisibleEventByUrl = (eventType, eventDetails, data, expired) => {
    // @TODO need to look at sending as a list; the parent tracker doesn't support this.
    if (_getParentTracker()) {
        try {
            if (neon.options.dev.showConsoleLogging) {
                console.info(printf('via parent:%s', eventType), data);
            }
            return neon.parentTracker.TrackerEvents.sendImageVisibleEventByUrl(
                _baseUrl(eventDetails.images[0].url));
        } catch (err) {
            console.error('Fail to send event via parent tracker', err, eventType, data);
            return false;
        }
    }
    const timeout = _getTimeoutForParent();

    if (timeout) {
        setTimeout(_sendToTracker, timeout, eventType, eventDetails);
        return true;
    }
    return false;
};

const _trackerSendImageClickEventByUrl = (eventType, eventDetails, data) => {
    if (_getParentTracker()) {
        try {
            if (neon.options.dev.showConsoleLogging) {
                console.info(printf('via parent:%s', eventType), data);
            }
            return neon.parentTracker.TrackerEvents.sendImageClickEventByUrl(
                data.vid,
                _baseUrl(eventDetails.images[0].url));
        } catch (err) {
            console.error('Fail to send event via parent tracker', err, eventType, data);
            return false;
        }
    }
    const timeout = _getTimeoutForParent();

    if (timeout) {
        setTimeout(_sendToTracker, timeout, eventType, eventDetails);
        return true;
    }
    return false;
};

const _sendToParentTracker = (eventType, eventDetails, data) => {

    // @TODO Implement missing wx, etc positional arguments.
    // @TODO switch to simplier control flow. objects/dynamic calls

    // If the tracker is found, or we are waiting for it, then send.
    const timeout = _getTimeoutForParent();

    if (_getParentTracker() || timeout) {
        switch (eventType) {
            case 'imageLoad':
                return _trackerSendImageLoadedEventByUrl(
                    eventType, eventDetails, data);
            case 'imageView':
                return _trackerSendImageVisibleEventByUrl(
                    eventType, eventDetails, data);
            case 'imageClick':
                return _trackerSendImageClickEventByUrl(
                    eventType, eventDetails, data);
            case 'autoplay':
            case 'play':
            //    return _tracker()
            case 'adPlay':
            //    return _tracker()
            case 'timeUpdate':
            //    return _tracker()
        }
    }
    // Fail back to sending directly.
    return false;
};

// Try to send the event payload through the parent or direct communication
const _sendToTracker = (eventType, eventDetails) => {
    const action = constants.eventCodeMap[eventType];
    let pcount;

    if (neon.currentVid === undefined) {
        pcount = null;
    } else {
        pcount = neon.playedVids.indexOf(neon.currentVid) + 1;
    }
    const data = _.pick(videojs.mergeOptions(

        // Page-level data
        neon.pageData,

        // Common event-level data
        {
            // Action identifier
            a: action,
            // Client's timestamp in localtime, in millis
            cts: (new Date()).getTime(),
            // 1-based index of video for videos in page
            pcount,
            ref: _getReferrer(),
            vid: neon.currentVid
        },

        // Event-type-specific data from eventDetails
        eventDetails

        // And filter unrecognized params
    ), _trackerAllowedParams);

    // Try to send via parent tracker but fallback to sending direct.
    if (_sendToParentTracker(eventType, eventDetails, data)) {
        return;
    }
    if (neon.options.dev.showConsoleLogging) {
        console.info(printf('direct:%s -> %s', eventType, action), data);
    }
    return reqwest({
        url: neon.options.tracking.neonApiUrl,
        method: 'GET',
        crossOrigin: true,
        data
    });
};

// Check if event needs remote tracking in configured trackEvents
const _commonTrack = (neonEventType, eventDetails) => {
    eventDetails = eventDetails || {};
    if (neon.options.tracking.events.indexOf(neonEventType) >= 0) {
        _sendToTracker(neonEventType, eventDetails);
    }
};

// Extract video id from page state based on config
const _extractVideoId = () => {
    // Extract the video id
    const idKey = neon.options.publisher.videoIdAttribute;
    let videoId = player.el().getAttribute(idKey);

    if (videoId === null) {
        throw new Error(
            'Fatal config error: player has no video id for key ' + idKey
        );
    }
    const regex = neon.options.publisher.videoIdAttributeRegex;

    // Check the usefulness of this regex code
    if (regex) {
        const matches = videoId.match(regex);

        if (matches !== null) {
            videoId = matches[0];
        } else {
            throw new Error(printf(
                'Fatal config error: video id %s does not match pattern %s',
                videoId,
                regex
            ));
        }
    }
    return videoId;
};

// Handle play event
const onPlay = (playerEvent, eventDetails) => {

    if (_isInAdState()) {
        return;
    }
    neon.currentVid = _extractVideoId();
    if (neon.playedVids.indexOf(neon.currentVid) < 0) {
        neon.playedVids.push(neon.currentVid);
        neon.percentsPlayed[neon.currentVid] = [];
    }

    eventDetails = eventDetails || {};
    // Set no-autoplay flag if absent
    if (!eventDetails.hasOwnProperty('aplay')) {
        eventDetails.aplay = player.autoplay();
    }
    // Set ad view flag
    eventDetails.adplay = neon.hasAdPlayed;
    _commonTrack('play', eventDetails);
};

// Build basenames param string given list of map {url, width, height}
const _buildBnsParamFromList = (list) => {
    const values = [];

    list.forEach((dict) => {
        // Use space delimiter; the param will be urlencoded later
        values.push(printf('%s %d %d',
            _getBasenameOf(dict.url),
            dict.width,
            dict.height)
        );
    });

    return values.join(',');
};

// Thoughtfully get the images associated to the event
// return list of Object{url, width, height} or an empty list
const _getImagesForEvent = (playerEvent) => {
    let url;
    let width;
    let height;
    const values = [];

    if (playerEvent.images !== undefined) {
        playerEvent.images.forEach((image) => {
            values.push({url, width, height});
        });
    } else if (player.poster()) {
        url = player.poster();
        width = player.posterImage.width();
        height = player.posterImage.height();
        values.push({url, width, height});
    }
    return values;
};

// Common implementation of image tracking event handler
const _commonImageTrack = (type, playerEvent, eventDetails) => {

    eventDetails = eventDetails || {};
    eventDetails.images = _getImagesForEvent(eventDetails);

    neon.currentVid = _extractVideoId();

    if (eventDetails.images.length === 0) {
        console.error(
            'Abort log player image ' + type + ' event: not enough info to continue');
        return;
    }

    if (type === 'imageClick') {
        // Unlike the other image tracking event formats, the bn includes no dimension
        eventDetails.bn = _getBasenameOf(eventDetails.images[0].url);
    } else {
        eventDetails.bns = _buildBnsParamFromList(eventDetails.images);
    }
    _commonTrack(type, eventDetails);
};

// Handle image load event
const onImageLoad = (playerEvent, eventDetails) => {
    _commonImageTrack('imageLoad', playerEvent, eventDetails);
};

// Handle image view event
const onImageView = (playerEvent, eventDetails) => {
    _commonImageTrack('imageView', playerEvent, eventDetails);
};

// Handle image click event
const onImageClick = (playerEvent, eventDetails) => {
    _commonImageTrack('imageClick', playerEvent, eventDetails);
};

// Handle ad play event
// Note there are various ad state models with different emitted events
// See events.js for more
const onAdPlay = (playerEvent, eventDetails) => {
    if (neon.hasAdPlayed) {
        return;
    }
    neon.hasAdPlayed = true;
    _commonTrack('adPlay', {aplay: false});
};

// Handle time update event; send once per interval per video
const onTimeUpdate = (playerEvent) => {

    // Measure the play progress by interval set in options
    const interval = Math.min(100, neon.options.tracking.timeUpdateInterval);
    const vid = neon.currentVid;
    // Begin at the first interval and not zero.
    let percent = interval;

    // Check for each step in [0..100], and keep
    // track of those we've already sent.
    for (; percent <= 100; percent += interval) {
        if (_getPercentPlayed() >= percent) {
            if (neon.percentsPlayed[vid].indexOf(percent) < 0) {
                neon.percentsPlayed[vid].push(percent);
                _commonTrack('timeUpdate', {prcnt: percent});
            }
        }
    }
};

// Get or generate an identifier for this pageload
const _getPageLoadId = () => {

    // Use the parent tracker's page id if available.
    try {
        if (_getParentTracker()) {
            return neon.parentTracker.TrackerEvents.getPageLoadId();
        }
    } catch (err) {
        console.error('Found parent neon module but could not get page load id!', err);
    }

    const randomString = (length, chars) => {
        let result = '';

        for (let i = length; i > 0; --i) {
            result += chars[Math.round(Math.random() * (chars.length - 1))];
        }
        return result;
    };

    // Taking from the other tracker Neon js implementations
    const _alphanum = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    return randomString(16, _alphanum);
};

// Handle the poster change event
const onPosterChange = (playerEvent) => {

    // Naively treat a change as a load and a view
    onImageLoad(playerEvent);
    onImageView(playerEvent);

    // And first play event as a image click for the poster
    // if the video is not configured for autoplay.
    player.one('play', onImageClick);
};

const _setPublisherId = () => {

    const parentId = window.neonPublisherId;
    const pluginId = neon.options.publisher.id;

    // Use the parent's publisher id if available
    if (parentId) {
        if (pluginId && parentId !== pluginId) {
            console.warn(printf(
                'Publisher ids do not match. Using parent id. parent:%s plugin:%s',
                parentId,
                pluginId));
        }
        neon.options.publisher.id = window.neonPublisherId;
    }
};

const _addParentTrackerVideoId = (id) => {
    if (_getParentTracker()) {
        try {
            neon.parentTracker.tracker.addVideoId(id);
        } catch (err) {
            console.error('Could not add video to parent tracker', err);
        }
    }
};

// Extract the current video id from the player and send to the parent
// tracker if it is set.
const _setCurrentVid = () => {
    const newVideoId = _extractVideoId();

    if (newVideoId !== neon.currentVid) {
        neon.currentVid = newVideoId;
        const timeout = _getTimeoutForParent();

        if (_getParentTracker()) {
            _addParentTrackerVideoId(neon.currentVid);
        } else if (timeout) {
            setTimeout(_addParentTrackerVideoId, timeout, neon.currentVid);
        }
    }
};

// Handle the video.js ready event
const onPlayerReady = (player_, options) => {

    player = player_;
    neon = player.neon;

    neon.options = options;
    neon.readyTime = (new Date()).getTime();

    _setPublisherId();

    neon.pageData = {
        // Fixed page idents
        pageid: _getPageLoadId(),
        page: _getPageUrl(),
        // Publisher id
        tai: options.publisher.id,
        // Tracking type
        ttype: options.tracking.type
    };

    // Store state of videos played
    neon.playedVids = [];
    neon.percentsPlayed = {};
    neon.hasAdPlayed = false;
    _setCurrentVid();

    // Associate events to their track handlers
    player.off(['posterchange', 'play', 'ad-play', 'timeupdate',
                'adstart', 'ads-ad-started', 'ima3-started']);

    // If the poster is set, track as though it had just changed
    if (player.poster()) {
        onPosterChange();
    }

    player.on('posterchange', onPosterChange);
    player.on('play', onPlay);
    player.on('ad-play', onAdPlay);
    player.on('timeupdate', onTimeUpdate);
    player.on(['adstart', 'ads-ad-started', 'ima3-started'], onAdPlay);
};

// Defer setup to video player's ready event.
const neonPlugin = function(options) {
    this.ready(() => {
        onPlayerReady(this, videojs.mergeOptions(defaults, options));
    });
};

// Register the plugin with video.js
videojs.plugin('neon', neonPlugin);

// Include the version number
neonPlugin.VERSION = '0.0.1';

// Allow simple es6 import
export default neonPlugin;
