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
    if (params) {
      window.fbq('track', eventName, params)
      return
    }
    window.fbq('track', eventName)
  }

  loadMetaPixel()
  if (typeof window.fbq === 'function') {
    window.fbq('init', PIXEL_ID)
    track('PageView')
  }

  document.addEventListener('click', function (event) {
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

    var action = (form.getAttribute('action') || '').trim().toLowerCase()
    if (action.indexOf('/app/create') === 0) {
      track('Lead', { content_name: 'blog_form_submit' })
    }
  })
})()
