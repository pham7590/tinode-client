import React from 'react';
import { FormattedMessage, defineMessages, injectIntl } from 'react-intl';

import Tinode from 'tinode-sdk';
const Drafty = Tinode.Drafty;

import ChatMessage from '../widgets/chat-message.jsx';
import ContactBadges from '../widgets/contact-badges.jsx';
import DocPreview from '../widgets/doc-preview.jsx';
import ErrorPanel from '../widgets/error-panel.jsx';
import GroupSubs from '../widgets/group-subs.jsx';
import ImagePreview from '../widgets/image-preview.jsx';
import Invitation from '../widgets/invitation.jsx';
import LetterTile from '../widgets/letter-tile.jsx';
import LoadSpinner from '../widgets/load-spinner.jsx';
import LogoView from './logo-view.jsx';
import SendMessage from '../widgets/send-message.jsx';

import { DEFAULT_P2P_ACCESS_MODE, IMAGE_PREVIEW_DIM, KEYPRESS_DELAY,
  MESSAGES_PAGE, MAX_EXTERN_ATTACHMENT_SIZE, MAX_IMAGE_DIM, MAX_INBAND_ATTACHMENT_SIZE,
  READ_DELAY, QUOTED_REPLY_LENGTH } from '../config.js';
import { blobToBase64, fileToBase64,
  imageScaled, makeImageUrl } from '../lib/blob-helpers.js';
import HashNavigation from '../lib/navigation.js';
import { bytesToHumanSize, shortDateFormat } from '../lib/strformat.js';

// Run timer with this frequency (ms) for checking notification queue.
const NOTIFICATION_EXEC_INTERVAL = 300;

const messages = defineMessages({
  online_now: {
    id: 'online_now',
    defaultMessage: 'online now',
    description: 'Indicator that the user or topic is currently online',
  },
  last_seen: {
    id: 'last_seen_timestamp',
    defaultMessage: 'Last seen',
    description: 'Label for the timestamp of when the user or topic was last online'
  },
  not_found: {
    id: 'title_not_found',
    defaultMessage: 'Not found',
    description: 'Title shown when topic is not found'
  },
  channel: {
    id: 'channel',
    defaultMessage: 'channel',
    description: 'Subtitle shown for channels in MessagesView instead of last seen'
  },
  file_attachment_too_large: {
    id: 'file_attachment_too_large',
    defaultMessage: 'The file size {size} exceeds the {limit} limit.',
    description: 'Error message when attachment is too large'
  },
  invalid_content: {
    id: 'invalid_content',
    defaultMessage: 'invalid content',
    description: 'Shown when the message is unreadable'
  },
});

// Checks if the access permissions are granted but not yet accepted.
function isUnconfirmed(acs) {
  if (acs) {
    const ex = acs.getExcessive() || '';
    return acs.isJoiner('given') && (ex.includes('R') || ex.includes('W'));
  }
  return false;
}

function isPeerRestricted(acs) {
  if (acs) {
    const ms = acs.getMissing() || '';
    return acs.isJoiner('want') && (ms.includes('R') || ms.includes('W'));
  }
  return false;
}

class MessagesView extends React.Component {
  constructor(props) {
    super(props);

    this.state = MessagesView.getDerivedStateFromProps(props, {});

    this.leave = this.leave.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.retrySend = this.retrySend.bind(this);
    this.sendImageAttachment = this.sendImageAttachment.bind(this);
    this.sendFileAttachment = this.sendFileAttachment.bind(this);
    this.sendKeyPress = this.sendKeyPress.bind(this);
    this.subscribe = this.subscribe.bind(this);
    this.handleScrollReference = this.handleScrollReference.bind(this);
    this.handleScrollEvent = this.handleScrollEvent.bind(this);
    this.handleDescChange = this.handleDescChange.bind(this);
    this.handleSubsUpdated = this.handleSubsUpdated.bind(this);
    this.handleMessageUpdate = this.handleMessageUpdate.bind(this);
    this.handleAllMessagesReceived = this.handleAllMessagesReceived.bind(this);
    this.handleInfoReceipt = this.handleInfoReceipt.bind(this);
    this.handleImagePostview = this.handleImagePostview.bind(this);
    this.handleClosePreview = this.handleClosePreview.bind(this);
    this.handleFormResponse = this.handleFormResponse.bind(this);
    this.handleContextClick = this.handleContextClick.bind(this);
    this.handleShowMessageContextMenu = this.handleShowMessageContextMenu.bind(this);
    this.handleNewChatAcceptance = this.handleNewChatAcceptance.bind(this);
    this.handleEnablePeer = this.handleEnablePeer.bind(this);
    this.handleAttachFile = this.handleAttachFile.bind(this);
    this.handleAttachImage = this.handleAttachImage.bind(this);
    this.handleCancelUpload = this.handleCancelUpload.bind(this);
    this.postReadNotification = this.postReadNotification.bind(this);
    this.clearNotificationQueue = this.clearNotificationQueue.bind(this);

    this.handlePickReply = this.handlePickReply.bind(this);
    this.handleCancelReply = this.handleCancelReply.bind(this);
    this.handleQuoteClick = this.handleQuoteClick.bind(this);

    this.chatMessageRefs = {};
    this.getOrCreateMessageRef = this.getOrCreateMessageRef.bind(this);

    this.readNotificationQueue = [];
    this.readNotificationTimer = null;
  }

  getOrCreateMessageRef(seqId) {
    if (this.chatMessageRefs.hasOwnProperty(seqId)) {
      return this.chatMessageRefs[seqId];
    }
    const ref = React.createRef();
    this.chatMessageRefs[seqId] = ref;
    return ref;
  }

  componentDidMount() {
    if (this.messagesScroller) {
      this.messagesScroller.addEventListener('scroll', this.handleScrollEvent);
    }
  }

  componentWillUnmount() {
    if (this.messagesScroller) {
      this.messagesScroller.removeEventListener('scroll', this.handleScrollEvent);
    }

    // Flush all notifications.
    this.clearNotificationQueue();
  }

  // Scroll last message into view on component update e.g. on message received
  // or vertical shrinking.
  componentDidUpdate(prevProps, prevState) {
    if (this.messagesScroller) {
      if (prevState.topic != this.state.topic || prevState.messageCount != this.state.messageCount) {
        // New message
        this.messagesScroller.scrollTop = this.messagesScroller.scrollHeight - this.state.scrollPosition;
      } else if (prevProps.viewportHeight > this.props.viewportHeight) {
        // Componet changed height.
        this.messagesScroller.scrollTop += prevProps.viewportHeight - this.props.viewportHeight;
      }
    }

    const topic = this.props.tinode ? this.props.tinode.getTopic(this.state.topic) : undefined;
    if (this.state.topic != prevState.topic) {
      if (prevState.topic && !Tinode.isNewGroupTopicName(prevState.topic)) {
        this.leave(prevState.topic);
      }

      if (topic) {
        topic.onData = this.handleMessageUpdate;
        topic.onAllMessagesReceived = this.handleAllMessagesReceived;
        topic.onInfo = this.handleInfoReceipt;
        topic.onMetaDesc = this.handleDescChange;
        topic.onSubsUpdated = this.handleSubsUpdated;
        topic.onPres = this.handleSubsUpdated;
      }
    }

    if (!this.props.applicationVisible) {
      // If application is not visible, flush all unsent 'read' notifications.
      this.clearNotificationQueue();
    } else {
      // Otherwise assume there are unread messages.
      this.postReadNotification(0);
    }

    if ((this.state.topic != prevState.topic) || !prevProps.ready) {
      this.subscribe(topic);
    }
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    let nextState = {};
    if (!nextProps.topic) {
      // Default state: no topic.
      nextState = {
        messageCount: 0,
        latestClearId: -1,
        onlineSubs: [],
        topic: null,
        title: '',
        avatar: null,
        isVerified: false,
        isStaff: false,
        isDangerous: false,
        docPreview: null,
        imagePreview: null,
        imagePostview: null,
        typingIndicator: false,
        scrollPosition: 0,
        fetchingMessages: false,
        peerMessagingDisabled: false,
        channel: false,
        reply: null
      };
    } else if (nextProps.topic != prevState.topic) {
      const topic = nextProps.tinode.getTopic(nextProps.topic);

      let reply = null;
      if (nextProps.forwardMessage) {
        // We are forwarding a message. Show preview.
        const preview = nextProps.forwardMessage.preview;
        reply = {
          content: preview,
          seq: null
        };
      }

      nextState = {
        topic: nextProps.topic,
        docPreview: null,
        imagePreview: null,
        imagePostview: null,
        typingIndicator: false,
        scrollPosition: 0,
        fetchingMessages: false,
        reply: reply
      };

      if (topic) {
        // Topic exists.
        const subs = [];

        if (nextProps.connected) {
          topic.subscribers((sub) => {
            if (sub.online && sub.user != nextProps.myUserId) {
              subs.push(sub);
            }
          });
        }

        Object.assign(nextState, {
          onlineSubs: subs
        });

        if (topic.public) {
          Object.assign(nextState, {
            title: topic.public.fn,
            avatar: makeImageUrl(topic.public.photo)
          });
        } else {
          Object.assign(nextState, {
            title: '',
            avatar: null
          });
        }

        const peer = topic.p2pPeerDesc();
        if (peer) {
          Object.assign(nextState, {
            peerMessagingDisabled: isPeerRestricted(peer.acs)
          });
        } else if (prevState.peerMessagingDisabled) {
          Object.assign(nextState, {
            peerMessagingDisabled: false
          });
        }
        Object.assign(nextState, {
          messageCount: topic.messageCount(),
          latestClearId: topic.maxClearId(),
          channel: topic.isChannelType()
        });
      } else {
        // Invalid topic.
        Object.assign(nextState, {
          messageCount: 0,
          latestClearId: -1,
          onlineSubs: [],
          title: '',
          avatar: null,
          peerMessagingDisabled: false,
          channel: false
        });
      }
    }

    if (nextProps.acs) {
      if (nextProps.acs.isWriter() != prevState.isWriter) {
        nextState.isWriter = !prevState.isWriter;
      }
      if (nextProps.acs.isReader() != prevState.isReader) {
        nextState.isReader = !prevState.isReader;
      }
      if (!nextProps.acs.isReader('given') != prevState.readingBlocked) {
        nextState.readingBlocked = !prevState.readingBlocked;
      }
      if (nextProps.acs.isSharer() != prevState.isSharer) {
        nextState.isSharer = !prevState.isSharer;
      }
    } else {
      if (prevState.isWriter) {
        nextState.isWriter = false;
      }
      if (prevState.isReader) {
        nextState.isReader = false;
      }
      if (!prevState.readingBlocked) {
        prevState.readingBlocked = true;
      }
      if (prevState.isSharer) {
        nextState.isSharer = false;
      }
    }

    if (isUnconfirmed(nextProps.acs) == !prevState.unconformed) {
      nextState.unconfirmed = !prevState.unconformed;
    }

    // Clear subscribers online when there is no connection.
    if (!nextProps.connected && prevState.onlineSubs && prevState.onlineSubs.length > 0) {
      nextState.onlineSubs = [];
    }

    return nextState;
  }

  subscribe(topic) {
    if (!topic || topic.isSubscribed() || !this.props.ready) {
      return;
    }

    // Is this a new topic?
    const newTopic = (this.props.newTopicParams && this.props.newTopicParams._topicName == this.props.topic);

    // Don't request the tags. They are useless unless the user
    // is the owner and is editing the topic.
    let getQuery = topic.startMetaQuery().withLaterDesc().withLaterSub();
    if (this.state.isReader || newTopic) {
      // Reading is either permitted or we don't know because it's a new topic. Ask for messages.
      getQuery = getQuery.withLaterData(MESSAGES_PAGE);
      if (this.state.isReader) {
        getQuery = getQuery.withLaterDel();
      }
      // And show "loading" spinner.
      this.setState({ fetchingMessages: true });
    }

    const setQuery = newTopic ? this.props.newTopicParams : undefined;
    topic.subscribe(getQuery.build(), setQuery)
      .then((ctrl) => {
        if (ctrl.code == 303) {
          // Redirect to another topic requested.
          HashNavigation.navigateTo(HashNavigation.setUrlTopic('', ctrl.params.topic));
          return;
        }
        if (this.state.topic != ctrl.topic) {
          this.setState({topic: ctrl.topic});
        }
        this.props.onNewTopicCreated(this.props.topic, ctrl.topic);
        // If there are unsent messages, try sending them now.
        topic.queuedMessages((pub) => {
          if (!pub._sending && topic.isSubscribed()) {
            this.retrySend(pub);
          }
        });
      })
      .catch((err) => {
        console.error("Failed subscription to", this.state.topic);
        this.props.onError(err.message, 'err');
        const blankState = MessagesView.getDerivedStateFromProps({}, {});
        blankState.title = this.props.intl.formatMessage(messages.not_found);
        this.setState(blankState);
      });
  }

  leave(oldTopicName) {
    if (!oldTopicName || !this.props.tinode.isTopicCached(oldTopicName)) {
      return;
    }
    const oldTopic = this.props.tinode.getTopic(oldTopicName);
    if (oldTopic && oldTopic.isSubscribed()) {
      oldTopic.leave(false)
        .catch(() => { /* do nothing here */ })
        .finally(() => {
          // We don't care if the request succeeded or failed.
          // The topic is dead regardless.
          this.setState({fetchingMessages: false});
          oldTopic.onData = undefined;
          oldTopic.onAllMessagesReceived = undefined;
          oldTopic.onInfo = undefined;
          oldTopic.onMetaDesc = undefined;
          oldTopic.onSubsUpdated = undefined;
          oldTopic.onPres = undefined;
        });
    }
  }

  handleScrollReference(node) {
    if (node) {
      node.addEventListener('scroll', this.handleScrollEvent);
      this.messagesScroller = node;
      this.messagesScroller.scrollTop = this.messagesScroller.scrollHeight - this.state.scrollPosition;
    }
  }

  // Get older messages
  handleScrollEvent(event) {
    this.setState({scrollPosition: event.target.scrollHeight - event.target.scrollTop});
    if (this.state.fetchingMessages) {
      return;
    }

    if (event.target.scrollTop <= 0) {
      const topic = this.props.tinode.getTopic(this.state.topic);
      if (topic && topic.isSubscribed() && topic.msgHasMoreMessages()) {
        this.setState({fetchingMessages: true}, () => {
          topic.getMessagesPage(MESSAGES_PAGE)
            .catch((err) => this.props.onError(err.message, 'err'))
            .finally(() => this.setState({fetchingMessages: false}));
          });
      }
    }
  }

  handleDescChange(desc) {
    if (desc.public) {
      this.setState({
        title: desc.public.fn,
        avatar: makeImageUrl(desc.public.photo)
      });
    } else {
      this.setState({
        title: '',
        avatar: null
      });
    }

    if (desc.acs) {
      this.setState({
        isWriter: desc.acs.isWriter(),
        isReader: desc.acs.isReader(),
        readingBlocked: !desc.acs.isReader('given'),
        unconfirmed: isUnconfirmed(desc.acs),
      });
    }
  }

  postReadNotification(seq) {
    // Ignore notifications if the app is invisible.
    if (!this.props.applicationVisible) {
      return;
    }

    // Set up the timer if it's not running already.
    if (!this.readNotificationTimer) {
      this.readNotificationTimer = setInterval(() => {
        if (this.readNotificationQueue.length == 0) {
          // Shut down the timer if the queue is empty.
          clearInterval(this.readNotificationTimer);
          this.readNotificationTimer = null;
          return;
        }

        let seq = -1;
        while (this.readNotificationQueue.length > 0) {
          const n = this.readNotificationQueue[0];
          if (n.topicName != this.state.topic) {
            // Topic has changed. Drop the notification.
            this.readNotificationQueue.shift();
            continue;
          }

          const now = new Date();
          if (n.sendAt <= now) {
            // Remove expired notification from queue.
            this.readNotificationQueue.shift();
            seq = Math.max(seq, n.seq);
          } else {
            break;
          }
        }

        // Send only one notification for the whole batch of messages.
        if (seq >= 0) {
          const topic = this.props.tinode.getTopic(this.state.topic);
          if (topic) {
            topic.noteRead(seq);
          }
        }
      }, NOTIFICATION_EXEC_INTERVAL);
    }

    const now = new Date();
    this.readNotificationQueue.push({
      topicName: this.state.topic,
      seq: seq,
      sendAt: now.setMilliseconds(now.getMilliseconds() + READ_DELAY)
    });
  }

  // Clear notification queue and timer.
  clearNotificationQueue() {
    this.readNotificationQueue = [];
    if (this.readNotificationTimer) {
      clearInterval(this.readNotificationTimer);
      this.readNotificationTimer = null;
    }
  }

  handleSubsUpdated() {
    if (this.state.topic) {
      const subs = [];
      const topic = this.props.tinode.getTopic(this.state.topic);
      topic.subscribers((sub) => {
        if (sub.online && sub.user != this.props.myUserId) {
          subs.push(sub);
        }
      });
      const newState = {onlineSubs: subs};
      const peer = topic.p2pPeerDesc();
      if (peer) {
        Object.assign(newState, {
          peerMessagingDisabled: isPeerRestricted(peer.acs)
        });
      } else if (this.state.peerMessagingDisabled) {
        Object.assign(newState, {
          peerMessagingDisabled: false
        });
      }
      this.setState(newState);
    }
  }

  // The 'msg' could be false-ish if some message ranges were deleted.
  handleMessageUpdate(msg) {
    const topic = this.props.tinode.getTopic(this.state.topic);
    if (!msg) {
      // msg could be null if one or more messages were deleted.
      // Updating state to force redraw.
      this.setState({latestClearId: topic.maxClearId()});
      return;
    }

    clearTimeout(this.keyPressTimer)
    this.setState({messageCount: topic.messageCount(), typingIndicator: false});

    // Scroll to the bottom if the message is added to the end of the message list.
    // TODO: This should be replaced by showing a "scroll to bottom" button.
    if (topic.isNewMessage(msg.seq)) {
      this.setState({scrollPosition: 0});
    }

    // Aknowledge messages except own messages. They are
    // automatically assumed to be read and recived.
    const status = topic.msgStatus(msg, true);
    if (status >= Tinode.MESSAGE_STATUS_SENT && msg.from != this.props.myUserId) {
      this.postReadNotification(msg.seq);
    }
    // This will send "received" notifications right away.
    this.props.onData(msg);
  }

  handleAllMessagesReceived(count) {
    this.setState({fetchingMessages: false});
    if (count > 0) {
      // 0 means "latest".
      this.postReadNotification(0);
    }
  }

  handleInfoReceipt(info) {
    switch (info.what) {
      case 'kp': {
        clearTimeout(this.keyPressTimer);
        this.keyPressTimer = setTimeout(() => {
          this.setState({typingIndicator: false});
        }, KEYPRESS_DELAY + 1000);
        if (!this.state.typingIndicator) {
          this.setState({typingIndicator: true});
        }
        break;
      }
      case 'read':
      case 'recv':
        // Redraw due to changed recv/read status.
        this.forceUpdate();
        break;
      default:
        console.info("Other change in topic: ", info.what);
    }
  }

  handleImagePostview(content) {
    this.setState({ imagePostview: content });
  }

  handleClosePreview() {
    if (this.state.imagePreview && this.state.imagePreview.url) {
      URL.revokeObjectURL(this.state.imagePreview.url);
    }
    this.setState({ imagePostview: null, imagePreview: null, docPreview: null });
  }

  handleFormResponse(action, text, data) {
    if (action == 'pub') {
      this.sendMessage(Drafty.attachJSON(Drafty.parse(text), data));
    } else if (action == 'url') {
      const url = new URL(data.ref);
      const params = url.searchParams;
      for (let key in data.resp) {
        if (data.resp.hasOwnProperty(key)) {
          params.set(key, data.resp[key]);
        }
      }
      ['name', 'seq'].map((key) => {
        if (data[key]) {
          params.set(key, data[key]);
        }
      });
      params.set('uid', this.props.myUserId);
      params.set('topic', this.state.topic);
      url.search = params;
      window.open(url, '_blank');
    } else {
      console.info("Unknown action in form", action);
    }
  }

  handleContextClick(e) {
    e.preventDefault();
    e.stopPropagation();
    this.props.showContextMenu({ topicName: this.state.topic, y: e.pageY, x: e.pageX });
  }

  handleShowMessageContextMenu(params, messageSpecificMenuItems) {
    if (params.userFrom == 'chan') {
      params.userFrom = this.state.topic;
      params.userName = this.state.title;
    }
    params.topicName = this.state.topic;
    const menuItems = messageSpecificMenuItems || [];
    const topic = this.props.tinode.getTopic(params.topicName);
    if (topic) {
      if (!topic.isChannelType()) {
        menuItems.push('message_delete');
      }
      const acs = topic.getAccessMode();
      if (acs && acs.isDeleter()) {
        menuItems.push('message_delete_hard');
      }
    }
    this.props.showContextMenu(params, menuItems);
  }

  handleNewChatAcceptance(action) {
    this.props.onNewChat(this.state.topic, action);
  }

  handleEnablePeer(e) {
    e.preventDefault();
    this.props.onChangePermissions(this.state.topic, DEFAULT_P2P_ACCESS_MODE, this.state.topic);
  }

  sendKeyPress() {
    const topic = this.props.tinode.getTopic(this.state.topic);
    if (topic.isSubscribed()) {
      topic.noteKeyPress();
    }
  }

  // sendMessage sends the message with an optional subscription to topic first.
  sendMessage(msg, uploadCompletionPromise, uploader) {
    let head;
    if (this.props.forwardMessage) {
      // We are forwarding a message.
      msg = this.props.forwardMessage.msg;
      head = this.props.forwardMessage.head;
      this.handleCancelReply();
    } else if (this.state.reply && this.state.reply.content) {
      // We are replying to a message in this topic.
      head = {reply: '' + this.state.reply.seq};
      // Turn it into Drafty so we can make a quoted Drafty object later.
      if (typeof msg == 'string') {
        msg = Drafty.parse(msg);
      }
      msg = Drafty.append(Drafty.sanitizeEntities(this.state.reply.content), msg);
      this.handleCancelReply();
    }
    this.props.sendMessage(msg, uploadCompletionPromise, uploader, head);
  }

  // Retry sending a message.
  retrySend(pub) {
    this.props.sendMessage(pub.content, undefined, undefined, pub.head);
  }

  // Send attachment as Drafty message:
  // - if file is too large, upload it and send a s link.
  // - if file is small enough, just send it in-band.
  sendFileAttachment(file) {
    // Server-provided limit reduced for base64 encoding and overhead.
    const maxInbandAttachmentSize = (this.props.tinode.getServerLimit('maxMessageSize',
      MAX_INBAND_ATTACHMENT_SIZE) * 0.75 - 1024) | 0;

    if (file.size > maxInbandAttachmentSize) {
      // Too large to send inband - uploading out of band and sending as a link.
      const uploader = this.props.tinode.getLargeFileHelper();
      const uploadCompletionPromise = uploader.upload(file);
      const msg = Drafty.attachFile(null, {
        mime: file.type,
        filename: file.name,
        size: file.size,
        urlPromise: uploadCompletionPromise
      });
      // Pass data and the uploader to the TinodeWeb.
      this.sendMessage(msg, uploadCompletionPromise, uploader);
    } else {
      // Small enough to send inband.
      fileToBase64(file)
        .then(b64 => this.sendMessage(Drafty.attachFile(null, {mime: b64.mime, data: b64.bits, filename: b64.name})))
        .catch(err => this.props.onError(err));
    }
  }

  // handleAttachFile method is called when [Attach file] button is clicked.
  handleAttachFile(file) {
    const maxExternAttachmentSize = this.props.tinode.getServerLimit('maxFileUploadSize', MAX_EXTERN_ATTACHMENT_SIZE);

    if (file.size > maxExternAttachmentSize) {
      // Too large.
      this.props.onError(this.props.intl.formatMessage(messages.file_attachment_too_large,
        {size: bytesToHumanSize(file.size), limit: bytesToHumanSize(maxExternAttachmentSize)}), 'err');
    } else {
      this.setState({
        docPreview: {
          file: file,
          name: file.name,
          size: file.size,
          type: file.type
        }
      });
    }
  }

  // sendImageAttachment sends the image bits inband as Drafty message.
  sendImageAttachment(caption, blob) {
    const mime = this.state.imagePreview.mime;
    const width = this.state.imagePreview.width;
    const height = this.state.imagePreview.height;
    const fname = this.state.imagePreview.name;

    // Server-provided limit reduced for base64 encoding and overhead.
    const maxInbandAttachmentSize = (this.props.tinode.getServerLimit('maxMessageSize',
      MAX_INBAND_ATTACHMENT_SIZE) * 0.75 - 1024) | 0;

    if (blob.size > maxInbandAttachmentSize) {
      // Too large to send inband - uploading out of band and sending as a link.
      const uploader = this.props.tinode.getLargeFileHelper();
      if (!uploader) {
        this.props.onError(this.props.intl.formatMessage(messages.cannot_initiate_upload));
        return;
      }
      const uploadCompletionPromise = uploader.upload(blob);

      // Make small preview to show while uploading.
      imageScaled(blob, IMAGE_PREVIEW_DIM, IMAGE_PREVIEW_DIM, -1, false)
        // Convert tiny image into base64 for serialization and previewing.
        .then(scaled => blobToBase64(scaled.blob))
        .then(b64 => {
            let msg = Drafty.insertImage(null, 0, {
              mime: mime,
              _tempPreview: b64.bits, // This preview will not be serialized.
              width: width,
              height: height,
              filename: fname,
              size: blob.size,
              urlPromise: uploadCompletionPromise
            });
            if (caption) {
              msg = Drafty.appendLineBreak(msg);
              msg = Drafty.append(msg, Drafty.parse(caption));
            }
            // Pass data and the uploader to the TinodeWeb.
            this.sendMessage(msg, uploadCompletionPromise, uploader);
        }).catch((err) => {
          this.props.onError(err, 'err');
        });
        return;
    }

    // Upload the image if it's too big to be send inband.
    blobToBase64(blob)
      .then(b64 => {
        let msg = Drafty.insertImage(null, 0, {
          mime: b64.mime,
          preview: b64.bits, // Serializable preview
          width: width,
          height: height,
          filename: fname,
          size: blob.size
        });
        if (caption) {
          msg = Drafty.appendLineBreak(msg);
          msg = Drafty.append(msg, Drafty.parse(caption));
        }
        this.sendMessage(msg);
      });
  }

  // handleAttachImage method is called when [Attach image] button is clicked.
  handleAttachImage(file) {
    const maxExternAttachmentSize = this.props.tinode.getServerLimit('maxFileUploadSize', MAX_EXTERN_ATTACHMENT_SIZE);

    // Get image dimensions and size, optionally scale it down.
    imageScaled(file, MAX_IMAGE_DIM, MAX_IMAGE_DIM, maxExternAttachmentSize, false)
      .then(scaled => {
        this.setState({imagePreview: {
          url: URL.createObjectURL(scaled.blob),
          blob: scaled.blob,
          name: scaled.name,
          width: scaled.width,
          height: scaled.height,
          size: scaled.blob.size,
          mime: scaled.mime
        }});
      }).catch(err => {
        this.props.onError(err, 'err');
      });
  }

  handleCancelUpload(seq, uploader) {
    const topic = this.props.tinode.getTopic(this.state.topic);
    const found = topic.findMessage(seq);
    if (found) {
      found._cancelled = true;
    }
    uploader.cancel();
  }

  // seq: seq ID of the source message
  // context: message content.
  // forwarded: true if the source message is also a forwarded message.
  // senderId: UID of the sender of the source message.
  // senderName: full name of the sender of the original message.
  handlePickReply(seq, content, senderId, senderName) {
    this.setState({reply: null});

    if (!seq || !content) {
      return;
    }

    content = typeof content == 'string' ? Drafty.init(content) : content;
    if (Drafty.isValid(content)) {
      content = Drafty.replyContent(content, QUOTED_REPLY_LENGTH);
    } else {
      // /!\ invalid content.
      content = Drafty.append(Drafty.init('\u26A0 '),
        Drafty.wrapInto(this.props.intl.formatMessage(messages.invalid_content), 'EM'));
    }

    this.setState({
      reply: {
        content: Drafty.quote(senderName, senderId, content),
        seq: seq
      }
    });
    this.props.onCancelForwardMessage();
  }

  handleCancelReply() {
    this.setState({reply: null});
    this.props.onCancelForwardMessage();
  }

  handleQuoteClick(replyToSeq) {
    const ref = this.getOrCreateMessageRef(replyToSeq);
    if (ref && ref.current) {
      ref.current.scrollIntoView({block: "center", behavior: "smooth"});
      ref.current.classList.add('flash');
      setTimeout(() => { ref.current.classList.remove('flash') } , 1000);
    } else {
      console.error("Unresolved message ref", replyToSeq);
    }
  }

  render() {
    const {formatMessage} = this.props.intl;

    let component;
    if (this.props.hideSelf) {
      component = null;
    } else if (!this.state.topic) {
      component = (
        <LogoView
          serverVersion={this.props.serverVersion}
          serverAddress={this.props.serverAddress} />
      );
    } else {
      let component2;
      if (this.state.imagePreview) {
        // Preview image before sending.
        component2 = (
          <ImagePreview
            content={this.state.imagePreview}
            tinode={this.props.tinode}
            reply={this.state.reply}
            onCancelReply={this.handleCancelReply}
            onClose={this.handleClosePreview}
            onSendMessage={this.sendImageAttachment} />
        );
      } else if (this.state.imagePostview) {
        // Expand received image.
        component2 = (
          <ImagePreview
            content={this.state.imagePostview}
            onClose={this.handleClosePreview} />
        );
      } else if (this.state.docPreview) {
        // Preview attachment before sending.
        component2 = (
          <DocPreview
            content={this.state.docPreview}
            tinode={this.props.tinode}
            reply={this.state.reply}
            onCancelReply={this.handleCancelReply}
            onClose={this.handleClosePreview}
            onSendMessage={this.sendFileAttachment} />
        );
      } else {
        const topic = this.props.tinode.getTopic(this.state.topic);
        const isChannel = topic.isChannelType();
        const groupTopic = topic.isGroupType() && !isChannel;
        const icon_badges = [];
        if (topic.trusted) {
          if (topic.trusted.verified) {
            icon_badges.push({icon: 'verified', color: 'badge-inv'});
          }
          if (topic.trusted.staff) {
            icon_badges.push({icon: 'staff', color: 'badge-inv'});
          }
          if (topic.trusted.danger) {
            icon_badges.push({icon: 'dangerous', color: 'badge-inv'});
          }
        }
        let messageNodes = [];
        let previousFrom = null;
        let chatBoxClass = null;
        topic.messages((msg, prev, next, i) => {
          let nextFrom = next ? (next.from || 'chan') : null;

          let sequence = 'single';
          let thisFrom = msg.from || 'chan';
          if (thisFrom == previousFrom) {
            if (thisFrom == nextFrom) {
              sequence = 'middle';
            } else {
              sequence = 'last';
            }
          } else if (thisFrom == nextFrom) {
            sequence = 'first';
          }
          previousFrom = thisFrom;

          const isReply = !(thisFrom == this.props.myUserId);
          const deliveryStatus = topic.msgStatus(msg, true);

          let userFrom = thisFrom, userName, userAvatar;
          const user = topic.userDesc(thisFrom);
          if (user && user.public) {
            userName = user.public.fn;
            userAvatar = makeImageUrl(user.public.photo);
          }
          chatBoxClass = groupTopic ? 'chat-box group' : 'chat-box';

          // Ref for this chat message.
          const ref = this.getOrCreateMessageRef(msg.seq);
          let replyToSeq = msg.head ? parseInt(msg.head.reply) : null;
          if (!replyToSeq || isNaN(replyToSeq)) {
            replyToSeq = null;
          }

          messageNodes.push(
            <ChatMessage
              tinode={this.props.tinode}
              content={msg.content}
              deleted={msg.hi}
              mimeType={msg.head ? msg.head.mime : null}
              timestamp={msg.ts}
              response={isReply}
              seq={msg.seq}
              isGroup={groupTopic}
              isChan={this.state.channel}
              userFrom={userFrom}
              userName={userName}
              userAvatar={userAvatar}
              sequence={sequence}
              received={deliveryStatus}
              uploader={msg._uploader}
              viewportWidth={this.props.viewportWidth}  // Used by `formatter`.
              showContextMenu={this.handleShowMessageContextMenu}
              onImagePreview={this.handleImagePostview}
              onFormResponse={this.handleFormResponse}
              onError={this.props.onError}
              onCancelUpload={this.handleCancelUpload}
              pickReply={this.handlePickReply}
              replyToSeq={replyToSeq}
              onQuoteClick={this.handleQuoteClick}
              ref={ref}
              userIsWriter={this.state.isWriter}
              key={msg.seq} />
          );
        });

        let lastSeen = null;
        if (isChannel) {
          lastSeen = formatMessage(messages.channel);
        } else {
          const cont = this.props.tinode.getMeTopic().getContact(this.state.topic);
          if (cont && Tinode.isP2PTopicName(cont.topic)) {
            if (cont.online) {
              lastSeen = formatMessage(messages.online_now);
            } else if (cont.seen) {
              lastSeen = formatMessage(messages.last_seen) + ": " +
                shortDateFormat(cont.seen.when, this.props.intl.locale);
              // TODO: also handle user agent in c.seen.ua
            }
          }
        }
        const avatar = this.state.avatar || true;
        const online = this.props.online ? 'online' + (this.state.typingIndicator ? ' typing' : '') : 'offline';

        component2 = (
          <>
            <div id="topic-caption-panel" className="caption-panel">
              {this.props.displayMobile ?
                <a href="#" id="hide-message-view" onClick={(e) => {e.preventDefault(); this.props.onHideMessagesView();}}>
                  <i className="material-icons">arrow_back</i>
                </a>
                :
                null}
              <div className="avatar-box">
                <LetterTile
                  tinode={this.props.tinode}
                  avatar={avatar}
                  topic={this.state.topic}
                  title={this.state.title} />
                {!isChannel ? <span className={online} /> : null}
              </div>
              <div id="topic-title-group">
                <div id="topic-title" className="panel-title">{
                  this.state.title ||
                  <i><FormattedMessage id="unnamed_topic" defaultMessage="Unnamed"
                    description="Title shown when the topic has no name" /></i>
                }<ContactBadges badges={icon_badges} /></div>
                <div id="topic-last-seen">{lastSeen}</div>
              </div>
              {groupTopic ?
                <GroupSubs
                  tinode={this.props.tinode}
                  subscribers={this.state.onlineSubs} /> :
                <div id="topic-users" />
              }
              <div>
                <a href="#" onClick={this.handleContextClick}>
                  <i className="material-icons">more_vert</i>
                </a>
              </div>
            </div>
            {this.props.displayMobile ?
              <ErrorPanel
                level={this.props.errorLevel}
                text={this.props.errorText}
                onClearError={this.props.onError} />
              : null}
            <LoadSpinner show={this.state.fetchingMessages} />
            <div id="messages-container">
              <div id="messages-panel" ref={this.handleScrollReference}>
                <ul id="scroller" className={chatBoxClass}>
                  {messageNodes}
                </ul>
              </div>
              {!this.state.isReader ?
              <div id="write-only-background">
                {this.state.readingBlocked ?
                <div id="write-only-note">
                  <FormattedMessage id="messages_not_readable" defaultMessage="no access to messages"
                    description="Message shown in topic without the read access" />
                </div>
                : null }
              </div>
              : null }
            </div>
            {this.state.peerMessagingDisabled && !this.state.unconfirmed ?
              <div id="peer-messaging-disabled-note">
                <i className="material-icons secondary">block</i> <FormattedMessage
                  id="peers_messaging_disabled" defaultMessage="Peer's messaging is disabled."
                  description="Shown when the p2p peer's messaging is disabled" /> <a href="#"
                    onClick={this.handleEnablePeer}><FormattedMessage id="enable_peers_messaging"
                    defaultMessage="Enable" description="Call to action to enable peer's messaging" /></a>.
              </div> : null}
            {this.state.unconfirmed ?
              <Invitation onAction={this.handleNewChatAcceptance} />
              :
              <SendMessage
                tinode={this.props.tinode}
                noInput={!!this.props.forwardMessage}
                disabled={!this.state.isWriter}
                onKeyPress={this.sendKeyPress}
                onSendMessage={this.sendMessage}
                onAttachFile={this.props.forwardMessage ? null : this.handleAttachFile}
                onAttachImage={this.props.forwardMessage ? null : this.handleAttachImage}
                onError={this.props.onError}
                reply={this.state.reply}
                onQuoteClick={this.handleQuoteClick}
                onCancelReply={this.handleCancelReply} />}
          </>
        );
      }

      component = <div id="topic-view">{component2}</div>
    }
    return component;
  }
};

export default injectIntl(MessagesView);
