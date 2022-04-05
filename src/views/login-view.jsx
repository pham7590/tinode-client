// Login form.
import React from 'react';
import { FormattedMessage } from 'react-intl';

import CheckBox from '../widgets/checkbox.jsx';
import VisiblePassword from '../widgets/visible-password.jsx';
import {ethers} from "ethers";

import LocalStorageUtil from '../lib/local-storage.js';
let currentAccount = null;
let signature = null;
let message = null;
let nonce = Math.floor(Math.random() * 101)
let date = Math.floor(new Date().getTime()/1000.0)
let login = null;
let password = null;

export default class LoginView extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      login: props.login,
      password: '',
      hostName: props.serverAddress,
      saveToken: props.persist
    };
    this.handleLoginChange = this.handleLoginChange.bind(this);
    this.handlePasswordChange = this.handlePasswordChange.bind(this);
    this.handleToggleSaveToken = this.handleToggleSaveToken.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleConnect = this.handleConnect.bind(this);
    //this.handleLoginReq = this.handleLoginReq.bind(this)
  }

  handleLoginChange(e) {
    this.setState({login: e});
  }

  handlePasswordChange(e) {
    this.setState({password: e});
  }

  handleToggleSaveToken() {
    this.props.onPersistenceChange(!this.state.saveToken);
    this.setState({saveToken: !this.state.saveToken});
  }

  handleSubmit() {
    this.props.onLogin(this.state.login.trim(), this.state.password.trim());
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
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner()
      message = date.toString() + "." + currentAccount.toString() + "." + nonce.toString() + "?TTL=600" + "&Timeout=700" + "&Uses=22"
      signature = await signer.signMessage(message)
      login = currentAccount.slice(currentAccount.length - 32)
      password = currentAccount
      this.handleLoginChange(login)
      this.handlePasswordChange(password)
      this.handleSubmit()
      //this.handleLoginReq()
    }
  }

  render() {
    let submitClasses = 'primary';
    if (this.props.disabled) {
      submitClasses += ' disabled';
    }

    return (
      <form id="login-form" onSubmit={this.handleSubmit}>
        <div className="dialog-buttons">
          <button className={submitClasses} id="metamask" onClick={this.handleConnect}>Sign in with Metamask</button>
        </div>
      </form>
    );
  }
};
/* END Login */
