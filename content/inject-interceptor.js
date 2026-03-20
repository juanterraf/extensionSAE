// Runs in MAIN world - patches fetch/XHR to intercept SAE API responses
(function() {
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = arguments[0];
    var urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : '');
    return origFetch.apply(this, arguments).then(function(response) {
      if (urlStr.indexOf('/proceedings/history') !== -1 &&
          urlStr.indexOf('/text') === -1 &&
          urlStr.indexOf('/flipbook') === -1 &&
          urlStr.indexOf('/link') === -1) {
        response.clone().json().then(function(json) {
          if (json && json.success && json.data) {
            window.postMessage({
              type: 'SAE_EXT_INTERCEPTED',
              proceeding: json.data.proceeding || null,
              stories: json.data.stories || null
            }, '*');
          }
        }).catch(function(){});
      }
      return response;
    });
  };

  // Also intercept XMLHttpRequest (axios uses this)
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._saeUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    if (xhr._saeUrl &&
        xhr._saeUrl.indexOf('/proceedings/history') !== -1 &&
        xhr._saeUrl.indexOf('/text') === -1 &&
        xhr._saeUrl.indexOf('/flipbook') === -1 &&
        xhr._saeUrl.indexOf('/link') === -1) {
      xhr.addEventListener('load', function() {
        try {
          var json = JSON.parse(xhr.responseText);
          if (json && json.success && json.data) {
            window.postMessage({
              type: 'SAE_EXT_INTERCEPTED',
              proceeding: json.data.proceeding || null,
              stories: json.data.stories || null
            }, '*');
          }
        } catch(e) {}
      });
    }
    return origSend.apply(this, arguments);
  };
})();
