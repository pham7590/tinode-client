// Account registration.
import React from 'react';
import { FormattedMessage } from 'react-intl';

import AvatarUpload from '../widgets/avatar-upload.jsx';
import CheckBox from '../widgets/checkbox.jsx';
import VisiblePassword from '../widgets/visible-password.jsx';

import LocalStorageUtil from '../lib/local-storage.js';
import { theCard } from '../lib/utils.js';

import { MAX_TITLE_LENGTH } from '../config.js';
import {ethers} from "ethers";

let currentAccount = null;
let signature = null;
let message = null;
let login = null;
let password = null;
let name = null;
let email = null;
let nonce = Math.floor(Math.random() * 101)
let date = Math.floor(new Date().getTime()/1000.0)

export default class CreateAccountView extends React.PureComponent {
  constructor(props) {
    super(props);

    this.state = {
      login: '',
      password: '',
      email: '',
      fn: '', // full/formatted name
      imageDataUrl: null,
      errorCleared: false,
      saveToken: LocalStorageUtil.getObject('keep-logged-in')
    };

    this.handleLoginChange = this.handleLoginChange.bind(this);
    this.handlePasswordChange = this.handlePasswordChange.bind(this);
    this.handleEmailChange = this.handleEmailChange.bind(this);
    this.handleFnChange = this.handleFnChange.bind(this);
    this.handleImageChanged = this.handleImageChanged.bind(this);
    this.handleToggleSaveToken = this.handleToggleSaveToken.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  handleLoginChange(e) {
    this.setState({login: e});
  }

  handlePasswordChange(password) {
    this.setState({password: password});
  }

  handleEmailChange(e) {
    this.setState({email: e})
  }

  handleFnChange(e) {
    this.setState({fn: e});
  }

  handleImageChanged(img) {
    this.setState({imageDataUrl: img});
  }

  handleToggleSaveToken() {
    LocalStorageUtil.setObject('keep-logged-in', !this.state.saveToken);
    this.setState({saveToken: !this.state.saveToken});
  }

  handleCreateAccount = () => {
    fetch("http://localhost:3000/new_token", {
      method: "POST",
      body: JSON.stringify({"message": message, "signature": signature})
    }).then(async res => {
      let response = await res.json()
      if (response.error === false) {
        console.log(response["token"])
        this.handleSubmit()
      } else {
        console.log(response.error)
      }
    });
  }

  handleSubmit() {
    this.setState({errorCleared: false});
    this.props.onCreateAccount(
      this.state.login.trim(),
      this.state.password.trim(),
      theCard(this.state.fn.trim().substring(0, MAX_TITLE_LENGTH), this.state.imageDataUrl),
      {'meth': 'email', 'val': this.state.email});
  }

  handleConnect = () => {
    if (window.ethereum) {
      window.ethereum.request({method: 'eth_requestAccounts'})
          .then(result => {
            this.handleAccountChanged(result)
          })
    } else {
      console.log('Install MetaMask')
    }
  }

  handleAccountChanged = async (accounts) => {
    if (accounts.length === 0) {
      console.log("Please connect to MetaMask");
    } else {
      currentAccount = accounts[0]
      this.handleLoginChange(currentAccount)
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner()
      message = date.toString() + "." + currentAccount.toString() + "." + nonce.toString() + "?TTL=600" + "&Timeout=700" + "&Uses=22"
      signature = await signer.signMessage(message)
      login = currentAccount.slice(currentAccount.length - 32)
      password = currentAccount
      name = currentAccount
      email = currentAccount + "@yahoo.com"
      this.handleLoginChange(login)
      this.handlePasswordChange(password)
      this.handleFnChange(name)
      this.handleEmailChange(email)
      this.handleCreateAccount()
    }
  }

  render() {
    let submitClasses = 'primary';
    if (this.props.disabled) {
      submitClasses += ' disabled';
    }

    return (
      <form className="panel-form-column" onSubmit={this.handleSubmit}>
        <div className="dialog-buttons">
          <button className={submitClasses} id="metamask" onClick={this.handleConnect}>Sign up with Metamask</button>
        </div>
        </form>
    );
  }
};
