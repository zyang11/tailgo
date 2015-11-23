// global $:false, jQuery:false
// jshint laxcomma: true, sub: true


//----------------------------------------------------------------------------
// Utility Functions.
//----------------------------------------------------------------------------
function formatBytes(size) {
  var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  var i = 0;
  while(size >= 1024) {
    size /= 1024;
    ++i;
  }
  return size.toFixed(1) + ' ' + units[i];
}

function formatFilename(state) {
  if (!state.id) return state.text;
  var size = formatBytes($(state.element).data('size'));
  return '<span>' + state.text + '</span>' + '<span style="float:right;">' + size + '</span>';
}

function endsWith(str, suffix) {
  return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

var escape_entity_map = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "/": '&#x2F;'
};

// This is the escapeHtml function from mustache.js.
function escapeHtml(string) {
  return String(string).replace(/[&<>\/]/g, function (s) {
    return escape_entity_map[s];
  });
}


//----------------------------------------------------------------------------
// Globals (this used to be a really short script ...).
//----------------------------------------------------------------------------
window.logviewer = null;     // Logview instance.
window.socket = null;        // SockJS socket.
window.connected = false;    //
window.socket_retries = 10;  // Number of connection retries.

var wspath = endsWith(window.relativeRoot, '/') ? 'ws' : '/ws';
window.wsurl = [window.location.protocol, '//', window.location.host, window.relativeRoot, wspath];
window.wsurl = window.wsurl.join('');


//----------------------------------------------------------------------------
// Models.
//----------------------------------------------------------------------------

// Changing the command model will re-execute the tail command on the backend.
var CommandModel = Backbone.Model.extend({
  defaults: {
    'mode': null,     // The current command (e.g. tail, tail+awk, tail+grep).
    'file': null,
    'script': null,   // The script to pass to commands that accept script.
    'tail-lines': 60  // i.e. tail -n ${tail-lines}.
  }
});

var UiModel = Backbone.Model.extend({
  defaults: {
    'panel-hidden': false,
    'history-lines': 2000
  }
});


//----------------------------------------------------------------------------
// Views.
//----------------------------------------------------------------------------
var ModeSelectView = Backbone.View.extend({
  initialize: function() {
    this.render();
  },

  events: {
    'change': 'modeChange'
  },

  modeChange: function(event) {
    this.model.set({'mode': event.target.value, 'script': null});
  },

  render: function() {
    this.$el.selectize();
    return this;
  }
});


//----------------------------------------------------------------------------
var FileSelectView = Backbone.View.extend({
  initialize: function() {
    this.render();
  },

  events: {
    'change': 'fileChange'
  },

  fileChange: function(event) {
    this.model.set({'file': event.target.value});
  },

  render: function() {
    this.$el.selectize({
      highlight: false,
      selectOnTab: true
    });
    return this;
  }
});


//----------------------------------------------------------------------------
var ScriptView = Backbone.View.extend({
  initialize: function() {
    this.listenTo(this.model, 'change:mode', this.renderMode);
    this.render();
  },

  events: {
    'change': '_changeScript'
  },

  _placeholders: {
    'awk': '{print $0; fflush()}',
    'sed': 's|.*|&,',
    'grep': '.*'
  },

  _changeScript: function() {
    var mode  = this.model.get('mode');
    var value = this.$el.val();

    // Pressing enter in an empty input field will use the placeholder value.
    if (value === "" && mode in this._placeholders) {
      value = this._placeholders[mode];
    }

    this.model.set({'script': value});
  },

  renderMode: function() {
    var mode = this.model.get('mode')
      , el = this.$el;

    if (mode in this._placeholders) {
      el.removeAttr('disabled');
      el.val('');
      el.attr('placeholder', this._placeholders[mode]);
    } else {
      el.attr('disabled', 'disabled');
      el.val('');
      el.attr('placeholder', 'mode "' + mode + '" does not accept any input');
    }

    return this;
  },

  render: function() {
    return this;
  }
});


//----------------------------------------------------------------------------
var PanelView = Backbone.View.extend({
  initialize: function(options) {
    this.options = options || {};

    this.listenTo(this.model, 'change:panel-hidden', this.hideShowPanel);
    this.listenTo(this.options.cmdmodel, 'change:file', this.updateHrefs);

    this.$downloadA = this.$el.find('.toolbar-item .button-group .action-download');
  },

  events: {
    'click .toolbar-item .button-group .action-hide-toolbar':  'setHidden',
    'click .toolbar-item .button-group .action-clear-logview': 'clearLogView',
    'click .toolbar-item .button-group .action-configure':     'toggleConfigurePopup'
  },

  // Update the download link whenever the selected file changes.
  updateHrefs: function() {
    this.$downloadA.attr('href', 'fetch/' + this.options.cmdmodel.get('file'));
  },

  hideShowPanel: function() {
    if (this.model.get('panel-hidden')) {
      this.$el.slideUp('fast');
    } else {
      this.$el.show();
    }

    resizeLogview();
  },

  setHidden: function() {
    this.model.set({'panel-hidden': true});
  },

  clearLogView: function() {
    window.logviewer.clear();
  },

  toggleConfigurePopup: function() {
    $('#configuration').toggle();
    $('.toolbar-item .button-group .action-configure').toggleClass('selected');
  }
});


//----------------------------------------------------------------------------
var ConfigurationView = Backbone.View.extend({
  initialize: function(options) {
    this.options = options || {};
    this.render();
  },

  historyLinesChanged: function(event) {
    this.model.set({'history-lines': parseInt(event.target.value)});
  },

  tailLinesChanged: function(event) {
    this.options.cmdmodel.set({'tail-lines': parseInt(event.target.value)});
  },

  render: function() {
    var view = this;
    var watch_options = {
      wait: 500,
      highlight: true,
      captureLength: 1,
      callback: function (value) {
        switch (this.id) {
          case 'history_lines':
            view.historyLinesChanged({'target': {'value': value}});
            break;
          case 'tail_lines':
            view.tailLinesChanged({'target': {'value': value}});
            break;
        }
      }
    };

    // Send input event only after user has finished typing.
    $("#history_lines").typeWatch(watch_options);
    $("#tail_lines").typeWatch(watch_options);

    // Set the configuration inputs to the model defaults.
    $('#history_lines')[0].value = this.model.get('history-lines');
    $('#tail_lines')[0].value = this.options.cmdmodel.get('tail-lines');
  }
});


//----------------------------------------------------------------------------
var ActionsView = Backbone.View.extend({
  initialize: function() {
    this.listenTo(this.model, 'change:panel-hidden', this.hideShowActions);
  },

  events: {
    'click .action-show-toolbar': 'setHidden'
  },

  hideShowActions: function() {
    if (this.model.get('panel-hidden')) {
      this.$el.removeClass('hidden');
    } else {
      this.$el.addClass('hidden');
    }
  },

  setHidden: function() {
    this.model.set({'panel-hidden': false});
  }
});

//----------------------------------------------------------------------------
// Logview "controller".
//----------------------------------------------------------------------------
function Logview(selector, history_lines) {
  var self = this
    , fragment = document.createDocumentFragment()
    , container = $(selector)
    , container_dom = container.get()[0]
    , auto_scroll = true
    , auto_scroll_offset = null
    , history = []
    , last_span = null
    , last_span_classes = '';

  this.history_lines = history_lines;
  this.container = container;

  this.logEntry = function(data) {
    var span = document.createElement('span');
    span.innerHTML = data;
    span.className = 'log-entry';
    return span;
  };

  this.logNotice = function(msg) {
    var span = document.createElement('span');
    span.innerHTML = msg;
    span.className = 'log-entry log-notice';
    return span;
  };

  this.write = function(spans) {
    var span, i;

    if (!spans.length) {
      return;
    }

    var scroll_after_write = this.is_at_bottom();

    for (i=0; i<spans.length; i++) {
      span = spans[i];
      history.push(span);
      fragment.appendChild(span);
    }

    container_dom.appendChild(fragment);
    self.trimHistory();
    fragment.innerHTML = '';

    if (auto_scroll && scroll_after_write) {
      self.scroll();
    }

    if (last_span) {
      last_span.className = last_span_classes;
    }

    last_span = history[history.length-1];
    last_span_classes = last_span.className;
    last_span.className = last_span_classes + ' log-entry-current';
  };

  this.trimHistory = function() {
    // Use this.history_lines = 0 for infinite history.
    if (this.history_lines !== 0 && history.length > this.history_lines) {
      for (var i=0; i<(history.length - this.history_lines); i++) {
        container_dom.removeChild(history.shift());
      }
    }
  };

  this.scroll = function() {
    container_dom.scrollTop = container_dom.scrollHeight;
  };

  this.is_at_bottom = function() {
    auto_scroll_offset = container_dom.scrollTop - (container_dom.scrollHeight - container_dom.offsetHeight);
    return Math.abs(auto_scroll_offset) < 50;
  };

  this.clear = function() {
    container_dom.innerHTML = '';
    fragment.innerHTML = '';
    history = [];
    last_span = null;
  };

  return self;
}


function resizeLogview() {
  var toolbar_height;

  if (window.uimodel.get('panel-hidden')) {
    toolbar_height = 0;
  } else {
    toolbar_height = $('.toolbar').outerHeight(true);
  }

  window.logviewer.container.height(window.innerHeight - toolbar_height);
}


//----------------------------------------------------------------------------
// Communication with the backend.
//----------------------------------------------------------------------------
window.socket = new SockJS(window.wsurl);

function onOpen() {
  window.connected = true;
}

function onClose() {
  window.connected = false;

  if (window.socket_retries === 0) {
    return;
  }

  window.setTimeout(function () {
    window.socket_retries -= 1;
    window.socket = new SockJS(window.wsurl);
    window.socket.onopen = onOpen;
    window.socket.onclose = onClose;
    window.socket.onmessage = onMessage;
  }, 1000);
}

function onMessage(e) {
  var data = JSON.parse(e.data)
    , spans = [], i, line
    , logEntry = window.logviewer.logEntry
    , logNotice = window.logviewer.logNotice;

  if ('err' in data) {
    if (data['err'] === 'truncated') {
      var now = window.moment().format();
      spans.push(logNotice(now + ' - ' + data['fn'] + ' - truncated'));
    } else {
      for (i=0; i<data['err'].length; i++) {
        line = data['err'][i];
        spans.push(logNotice(line));
      }
    }
  } else {
    $.each(data, function (fn, payload) {
      for (i=0; i<payload.length; i++) {
        line = escapeHtml(payload[i]);
        spans.push(logEntry(line.replace(/\n$/, '')));
      }
    });
  }

  window.logviewer.write(spans);
}

function wscommand(model) {
  var fn = model.get('file')
    , mode = model.get('mode')
    , script = model.get('script');

  (function() {
    if (window.connected) {
      if (fn === null) {
        window.logviewer.clear();
        return;
      }

      var msg = {};
      msg[mode] = fn;
      msg['tail-lines'] = model.get('tail-lines');

      if (mode != 'tail') {
        if (!script) {
          return;
        } else {
          msg['script'] = script;
        }
      }

      window.logviewer.clear();
      window.socket.send(JSON.stringify(msg));
    } else {
      window.setTimeout(arguments.callee, 20);
    }
  })();
}


//----------------------------------------------------------------------------
// Connect everything together.
//----------------------------------------------------------------------------

// Models.
window.cmdmodel = new CommandModel();
window.uimodel = new UiModel();

// Logview object.
window.logviewer = Logview('#logviewer', window.uimodel.get('history-lines'));

// Backend communication.
window.socket.onopen = onOpen;
window.socket.onclose = onClose;
window.socket.onmessage = onMessage;
window.cmdmodel.on('change', function(model) {
  wscommand(model);
});

// Views.
window.fileselectview = new FileSelectView({model: window.cmdmodel, el: '#logselect  > select'});
window.modeselectview = new ModeSelectView({model: window.cmdmodel, el: '#modeselect > select'});
window.scriptview  = new ScriptView({model:  window.cmdmodel, el: '#scriptinput input'});
window.actionsview = new ActionsView({model: window.uimodel,  el: '.quickbar .button-group'});
window.buttonsview = new PanelView({model:   window.uimodel, cmdmodel: window.cmdmodel, el: '.toolbar'});
window.configview  = new ConfigurationView({model: window.uimodel, cmdmodel: window.cmdmodel, el: '#configuration'});

// Set the mode and logfile to the first option from the select element.
var _first_logfile = $('#logselect  > select')[0].options[0].value;
var _first_mode    = $('#modeselect > select')[0].options[0].value;
window.cmdmodel.set({'file': _first_logfile});
window.cmdmodel.set({'mode': _first_mode});

//
window.uimodel.on('change:history-lines', function(model) {
  var lines = model.get('history-lines');
  window.logviewer.history_lines = lines;
});

// @todo: ...
resizeLogview();
$(window).resize(resizeLogview);


//----------------------------------------------------------------------------
// Shortcuts:
//   ctrl+l - clear screen (major conflict with 'go to addressbar')
//   ctrl+= - increase font size (logview div only)
//   ctrl+- - decrease font size (logview div only)
//   ret    - mark current time
function isInputFocused() {
  return document.activeElement.nodeName === 'INPUT';
}

jwerty.key('ctrl+l', window.logviewer.clear);
jwerty.key('q', function () {
  if (isInputFocused()) { return true; }
  fileselectview.$el.select2('open');
  return false;
});

jwerty.key('w', function () {
  if (isInputFocused()) { return true; }
  modeselectview.$el.select2('open');
  return false;
});

jwerty.key('e', function () {
  if (isInputFocused()) { return true; }
  scriptview.$el.focus();
  return false;
});
