import { useEffect } from 'react'

let lockCount = 0
let saved = {
  htmlOverflow: '',
  bodyOverflow: '',
  bodyPosition: '',
  bodyTop: '',
  bodyWidth: '',
  scrollY: 0,
}

function applyLock() {
  const html = document.documentElement
  const body = document.body
  saved.scrollY = window.scrollY
  saved.htmlOverflow = html.style.overflow
  saved.bodyOverflow = body.style.overflow
  saved.bodyPosition = body.style.position
  saved.bodyTop = body.style.top
  saved.bodyWidth = body.style.width
  html.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${saved.scrollY}px`
  body.style.width = '100%'
}

function releaseLock() {
  const html = document.documentElement
  const body = document.body
  html.style.overflow = saved.htmlOverflow
  body.style.overflow = saved.bodyOverflow
  body.style.position = saved.bodyPosition
  body.style.top = saved.bodyTop
  body.style.width = saved.bodyWidth
  window.scrollTo(0, saved.scrollY)
}

/** Impede rolagem da página atrás de modais/drawers (com contador para vários abertos). */
export function useLockPageScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    lockCount += 1
    if (lockCount === 1) applyLock()
    return () => {
      lockCount -= 1
      if (lockCount === 0) releaseLock()
    }
  }, [locked])
}
