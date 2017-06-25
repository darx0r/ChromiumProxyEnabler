var ProxyFormController = function(id) {
  this.form_ = document.getElementById(id);

  if (!this.form_)
    throw chrome.i18n.getMessage('errorIdNotFound', id);
  else if (this.form_.nodeName !== 'FORM')
    throw chrome.i18n.getMessage('errorIdNotForm', id);

  this.configGroups_ = document.querySelectorAll('#' + id + ' > fieldset');

  this.bindEventHandlers_();
  this.readCurrentState_();

  this.handleProxyErrors_();
};

ProxyFormController.ProxyTypes = {
  AUTO: 'auto_detect',
  FIXED: 'fixed_servers',
  SYSTEM: 'system'
};

ProxyFormController.WindowTypes = {
  REGULAR: 1,
  INCOGNITO: 2
};

ProxyFormController.LevelOfControl = {
  NOT_CONTROLLABLE: 'not_controllable',
  OTHER_EXTENSION: 'controlled_by_other_extension',
  AVAILABLE: 'controllable_by_this_extension',
  CONTROLLING: 'controlled_by_this_extension'
};

ProxyFormController.WrappedProxyConfig;

ProxyFormController.getPersistedSettings = function() {
  var result = null;
  if (window.localStorage['proxyConfig'] !== undefined)
    result = JSON.parse(window.localStorage['proxyConfig']);

  return result ? result : null;
};

ProxyFormController.setPersistedSettings = function(config) {
  window.localStorage['proxyConfig'] = JSON.stringify(config);
};

ProxyFormController.prototype = {

  config_: {regular: null, incognito: null},

  isAllowedIncognitoAccess_: false,

  get bypassList() {
    return document.getElementById('bypassList').value.split(/\s*(?:,|^)\s*/m);
  },

  set bypassList(data) {
    if (!data)
      data = [];
    document.getElementById('bypassList').value = data.join(', ');
  },

  get singleProxy() {
    var checkbox = document.getElementById('singleProxyForEverything');
    return checkbox.checked ? this.httpProxy : null;
  },

  set singleProxy(data) {
    var checkbox = document.getElementById('singleProxyForEverything');
    checkbox.checked = !!data;

    if (data)
      this.httpProxy = data;

    if (checkbox.checked)
      checkbox.parentNode.parentNode.classList.add('single');
    else
      checkbox.parentNode.parentNode.classList.remove('single');
  },

  get httpProxy() {
    return this.getProxyImpl_('Http');
  },

  set httpProxy(data) {
    this.setProxyImpl_('Http', data);
  },

  get httpsProxy() {
    return this.getProxyImpl_('Https');
  },

  set httpsProxy(data) {
    this.setProxyImpl_('Https', data);
  },

  get ftpProxy() {
    return this.getProxyImpl_('Ftp');
  },

  set ftpProxy(data) {
    this.setProxyImpl_('Ftp', data);
  },

  get fallbackProxy() {
    return this.getProxyImpl_('Fallback');
  },

  set fallbackProxy(data) {
    this.setProxyImpl_('Fallback', data);
  },

  getProxyImpl_: function(type) {
    var result = {
      scheme: document.getElementById('proxyScheme' + type).value,
      host: document.getElementById('proxyHost' + type).value,
      port: parseInt(document.getElementById('proxyPort' + type).value, 10)
    };
    return (result.scheme && result.host && result.port) ? result : undefined;
  },

  setProxyImpl_: function(type, data) {
    if (!data)
      data = {scheme: 'http', host: '', port: ''};

    document.getElementById('proxyScheme' + type).value = data.scheme;
    document.getElementById('proxyHost' + type).value = data.host;
    document.getElementById('proxyPort' + type).value = data.port;
  },

  readCurrentState_: function() {
    chrome.extension.isAllowedIncognitoAccess(
        this.handleIncognitoAccessResponse_.bind(this));
  },

  handleIncognitoAccessResponse_: function(state) {
    this.isAllowedIncognitoAccess_ = state;
    chrome.proxy.settings.get({incognito: false},
        this.handleRegularState_.bind(this));
    if (this.isAllowedIncognitoAccess_) {
      chrome.proxy.settings.get({incognito: true},
          this.handleIncognitoState_.bind(this));
    }
  },

  handleRegularState_: function(c) {
    if (c.levelOfControl === ProxyFormController.LevelOfControl.AVAILABLE ||
        c.levelOfControl === ProxyFormController.LevelOfControl.CONTROLLING) {
      this.recalcFormValues_(c.value);
      this.config_.regular = c.value;
    } else {
      this.handleLackOfControl_(c.levelOfControl);
    }
  },

  handleIncognitoState_: function(c) {
    if (c.levelOfControl === ProxyFormController.LevelOfControl.AVAILABLE ||
        c.levelOfControl === ProxyFormController.LevelOfControl.CONTROLLING) {

      this.config_.incognito = c.value;
    } else {
      this.handleLackOfControl_(c.levelOfControl);
    }
  },

  bindEventHandlers_: function() {
    this.form_.addEventListener('click', this.dispatchFormClick_.bind(this));
  },

  dispatchFormClick_: function(e) {
    var t = e.target;

    if (t.nodeName === 'INPUT' &&
        t.getAttribute('type') === 'checkbox' &&
        t.parentNode.parentNode.parentNode.classList.contains('active')) {
      return this.toggleSingleProxyConfig_(e);

    } else {
      // Walk up the tree until we hit `form > fieldset` or fall off the top
      while (t && (t.nodeName !== 'FIELDSET' ||
             t.parentNode.nodeName !== 'FORM')) {
        t = t.parentNode;
      }
      if (t) {
        this.changeActive_(t);
        return this.applyChanges_(e);
      }
    }
    return true;
  },

  changeActive_: function(fieldset) {
    for (var i = 0; i < this.configGroups_.length; i++) {
      var el = this.configGroups_[i];
      var radio = el.querySelector("input[type='radio']");
      if (el === fieldset) {
        el.classList.add('active');
        radio.checked = true;
      } else {
        el.classList.remove('active');
      }
    }
    this.recalcDisabledInputs_();
  },

  recalcDisabledInputs_: function() {
    var i, j;
    for (i = 0; i < this.configGroups_.length; i++) {
      var el = this.configGroups_[i];
      var inputs = el.querySelectorAll(
          "input:not([type='radio']), select, textarea");
      if (el.classList.contains('active')) {
        for (j = 0; j < inputs.length; j++) {
          inputs[j].removeAttribute('disabled');
        }
      } else {
        for (j = 0; j < inputs.length; j++) {
          inputs[j].setAttribute('disabled', 'disabled');
        }
      }
    }
  },

  applyChanges_: function(e) {
    e.preventDefault();
    e.stopPropagation();

    if (this.isAllowedIncognitoAccess_)
      this.config_.incognito = this.generateProxyConfig_();

    this.config_.regular = this.generateProxyConfig_();

    chrome.proxy.settings.set(
        {value: this.config_.regular, scope: 'regular'},
        this.callbackForRegularSettings_.bind(this));
    chrome.extension.sendRequest({type: 'clearError'});
  },

  callbackForRegularSettings_: function() {
    if (chrome.runtime.lastError) {
      this.generateAlert_(chrome.i18n.getMessage('errorSettingRegularProxy'));
      return;
    }
    if (this.config_.incognito) {
      chrome.proxy.settings.set(
          {value: this.config_.incognito, scope: 'incognito_persistent'},
          this.callbackForIncognitoSettings_.bind(this));
    } else {
      ProxyFormController.setPersistedSettings(this.config_);
      this.generateAlert_(chrome.i18n.getMessage('successfullySetProxy'));
    }
  },

  callbackForIncognitoSettings_: function() {
    if (chrome.runtime.lastError) {
      this.generateAlert_(chrome.i18n.getMessage('errorSettingIncognitoProxy'));
      return;
    }
    ProxyFormController.setPersistedSettings(this.config_);
    this.generateAlert_(
        chrome.i18n.getMessage('successfullySetProxy'));
  },

  generateAlert_: function(msg, close) {
    var success = document.createElement('div');
    success.classList.add('overlay');
    success.setAttribute('role', 'alert');
    success.textContent = msg;
    document.body.appendChild(success);

    setTimeout(function() { success.classList.add('visible'); }, 10);
    setTimeout(function() {
      if (close === false)
        success.classList.remove('visible');
      else
        window.close();
    }, 3000);
  },

  generateProxyConfig_: function() {
    var active = document.getElementsByClassName('active')[0];
    switch (active.id) {
      case ProxyFormController.ProxyTypes.SYSTEM:
        return {mode: 'system'};
      case ProxyFormController.ProxyTypes.FIXED:
        var config = {mode: 'fixed_servers'};
        if (this.singleProxy) {
          config.rules = {
            singleProxy: this.singleProxy,
            bypassList: this.bypassList
          };
        } else {
          config.rules = {
            proxyForHttp: this.httpProxy,
            proxyForHttps: this.httpsProxy,
            proxyForFtp: this.ftpProxy,
            fallbackProxy: this.fallbackProxy,
            bypassList: this.bypassList
          };
        }
        return config;
    }
  },

  toggleSingleProxyConfig_: function(e) {
    var checkbox = e.target;
    if (checkbox.nodeName === 'INPUT' &&
        checkbox.getAttribute('type') === 'checkbox') {
      if (checkbox.checked)
        checkbox.parentNode.parentNode.classList.add('single');
      else
        checkbox.parentNode.parentNode.classList.remove('single');
    }
  },

  recalcFormValues_: function(c) {
    /*
    // Normalize `auto_detect`
    if (c.mode === 'auto_detect')
      c.mode = 'pac_script';
    */

    this.changeActive_(document.getElementById(c.mode));

    if (c.rules) {
      var rules = c.rules;
      if (rules.singleProxy) {
        this.singleProxy = rules.singleProxy;
      } else {
        this.singleProxy = null;
        this.httpProxy = rules.proxyForHttp;
        this.httpsProxy = rules.proxyForHttps;
        this.ftpProxy = rules.proxyForFtp;
        this.fallbackProxy = rules.fallbackProxy;
      }
      this.bypassList = rules.bypassList;
    } else {
      this.singleProxy = true;
      this.httpProxy = {scheme:"http", host:"127.0.0.1", port:8080};
      this.httpsProxy = null;
      this.ftpProxy = null;
      this.fallbackProxy = null;
      this.bypassList = '';
    }
  },

  handleLackOfControl_: function(l) {
    var msg;
    if (l === ProxyFormController.LevelOfControl.NO_ACCESS)
      msg = chrome.i18n.getMessage('errorNoExtensionAccess');
    else if (l === ProxyFormController.LevelOfControl.OTHER_EXTENSION)
      msg = chrome.i18n.getMessage('errorOtherExtensionControls');
    this.generateAlert_(msg);
  },

  handleProxyErrors_: function() {
    chrome.extension.sendRequest(
        {type: 'getError'},
        this.handleProxyErrorHandlerResponse_.bind(this));
  },

  handleProxyErrorHandlerResponse_: function(response) {
    if (response.result !== null) {
      var error = JSON.parse(response.result);
      console.error(error);
      this.generateAlert_(
          chrome.i18n.getMessage(
              error.details ? 'errorProxyDetailedError' : 'errorProxyError',
              [error.error, error.details]),
          false);
    }
  }
};
