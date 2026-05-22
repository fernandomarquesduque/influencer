import { Modal } from 'antd'
import { resetPageScrollLock } from './useLockPageScroll'

/** Remove máscaras de modal órfãs (conteúdo já fechou, overlay ficou no DOM). */
function removeOrphanModalMasks(): void {
  const roots = document.querySelectorAll('.ant-modal-root')
  roots.forEach((root) => {
    const wrap = root.querySelector('.ant-modal-wrap')
    if (!wrap) {
      root.remove()
      return
    }
    const wrapStyle = window.getComputedStyle(wrap)
    const wrapHidden =
      wrapStyle.display === 'none' ||
      wrapStyle.visibility === 'hidden' ||
      wrap.getAttribute('aria-hidden') === 'true'
    if (wrapHidden) {
      root.remove()
    }
  })

  document.querySelectorAll('.ant-modal-mask').forEach((mask) => {
    const root = mask.closest('.ant-modal-root')
    if (!root || !root.querySelector('.ant-modal-wrap')) {
      mask.remove()
    }
  })
}

/** Libera scroll e overlays que impedem cliques em qualquer página do app. */
export function cleanupAppUiBlockers(): void {
  resetPageScrollLock()
  Modal.destroyAll()
  document.body.classList.remove('ant-scrolling-effect')
  removeOrphanModalMasks()
}
