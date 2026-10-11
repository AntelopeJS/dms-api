import { REQUEST_PANEL } from '../utils/requestDrawer'

// The side panel a request table's row opens its request in, docked on the
// right of the page (`RequestDrawerHost`). Universal: a reload with a request
// open renders the panel in place.
export default defineDmsPlugin(() => {
  registerSidePanel(REQUEST_PANEL)
})
