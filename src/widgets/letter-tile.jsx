import React from 'react';

import Tinode from 'tinode-sdk';

import { idToColorClass } from '../lib/strformat.js';
import { sanitizeImageUrl } from '../lib/utils.js';

export default class LetterTile extends React.PureComponent {
  render() {
    let avatar;
    if (this.props.avatar === true) {
      const isGroup = (Tinode.topicType(this.props.topic) == 'grp');
      const iconColor = idToColorClass(this.props.topic, isGroup);
      if (this.props.topic && this.props.title && this.props.title.trim()) {
        const letter = this.props.title.trim().charAt(0);
        const className = 'lettertile ' + iconColor;
        avatar = (<div className={className}><div>{letter}</div></div>)
      } else {
        const className = 'material-icons ' + iconColor;
        avatar = isGroup ?
          <i className={className}>group</i> : <i className={className}>person</i>;
      }
    } else if (this.props.avatar) {
      const url = this.props.tinode.authorizeURL(sanitizeImageUrl(this.props.avatar));
      // If avatar image is invalid, show a placeholder.
      avatar = <img className="avatar" alt="avatar" src={url}
        onError={(e)=>{e.target.onerror = null; e.target.src="../img/broken_image.png"}} />;
    } else {
      avatar = null;
    }
    return avatar;
  }
}
