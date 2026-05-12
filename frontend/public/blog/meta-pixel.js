/**
 * Meta Pixel — atributos opcionais em qualquer elemento clicável:
 * - data-fbq-custom="NomeEvento" → fbq('trackCustom', NomeEvento, params)
 * - data-fbq-event="Lead" → fbq('track', 'Lead', params)
 * Outros data-fbq-* viram chaves do objeto params (ex.: data-fbq-source="hero").
 */
;(function () {
  var PIXEL_ID = '236287274596638'

  function loadMetaPixel() {
    if (window.fbq) return
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments)
      }
      if (!f._fbq) f._fbq = n
      n.push = n
      n.loaded = true
      n.version = '2.0'
      n.queue = []
      t = b.createElement(e)
      t.async = true
      t.src = v
      s = b.getElementsByTagName(e)[0]
      s.parentNode.insertBefore(t, s)
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js')
  }

  function track(eventName, params) {
    if (typeof window.fbq !== 'function') return
    if (params && Object.keys(params).length > 0) {
      window.fbq('track', eventName, params)
      return
    }
    window.fbq('track', eventName)
  }

  function trackCustom(name, params) {
    if (typeof window.fbq !== 'function') return
    if (params && Object.keys(params).length > 0) {
      window.fbq('trackCustom', name, params)
      return
    }
    window.fbq('trackCustom', name)
  }

  function collectDataFbqParams(el, excludeKeys) {
    var params = {}
    if (!(el instanceof Element)) return params
    var attrs = el.attributes
    var ex = excludeKeys || { event: 1, custom: 1 }
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name
      if (name.substring(0, 9) !== 'data-fbq-') continue
      var key = name.substring(9)
      if (ex[key]) continue
      params[key] = attrs[i].value
    }
    return params
  }

  loadMetaPixel()
  if (typeof window.fbq === 'function') {
    window.fbq('init', PIXEL_ID)
    track('PageView')
  }

  document.addEventListener('click', function (event) {
    var tagged =
      event.target instanceof Element
        ? event.target.closest('[data-fbq-custom], [data-fbq-event]')
        : null
    if (tagged) {
      var customName = tagged.getAttribute('data-fbq-custom')
      var stdEvent = tagged.getAttribute('data-fbq-event')
      if (customName) {
        trackCustom(customName, collectDataFbqParams(tagged, { custom: 1 }))
      } else if (stdEvent) {
        var p = collectDataFbqParams(tagged, { event: 1 })
        track(stdEvent, Object.keys(p).length > 0 ? p : undefined)
      }
      return
    }

    var target = event.target instanceof Element ? event.target.closest('a') : null
    if (!target) return

    var href = (target.getAttribute('href') || '').trim().toLowerCase()
    if (!href) return

    if (href.indexOf('/app/create') === 0 || href.indexOf('/search') === 0) {
      track('Lead', { content_name: 'blog_cta' })
      return
    }

    if (href.indexOf('wa.me/') !== -1 || href.indexOf('whatsapp.com/') !== -1) {
      track('Contact', { content_name: 'blog_whatsapp' })
    }
  })

  document.addEventListener('submit', function (event) {
    var form = event.target
    if (!(form instanceof HTMLFormElement)) return

    var customForm = form.getAttribute('data-fbq-custom')
    if (customForm) {
      trackCustom(customForm, collectDataFbqParams(form, { custom: 1 }))
    }

    var action = (form.getAttribute('action') || '').trim().toLowerCase()
    if (action.indexOf('/app/create') === 0) {
      track('Lead', { content_name: 'blog_form_submit' })
    }
  })
})()
