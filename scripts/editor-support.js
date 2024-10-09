import {
  decorateBlock,
  decorateBlocks,
  decorateButtons,
  decorateIcons,
  decorateSections,
  loadBlock,
  loadSections,
} from './aem.js';
import { decorateRichtext } from './editor-support-rte.js';
import { decorateMain } from './scripts.js';

function getState(block) {
  const state = {};
  if (block.matches('.tabs')) state.activeTabId = block.querySelector('[aria-selected="true"]').dataset.tabId;
  if (block.matches('.carousel')) {
    const container = block.querySelector('.panel-container');
    state.scrollLeft = container.scrollLeft;
  }
  return state;
}

function restoreState(newBlock, state) {
  if (state.activeTabId) {
    newBlock.querySelector(`[data-tab-id="${state.activeTabId}"]`).click();
  }
  if (state.scrollLeft) {
    newBlock.querySelector('.panel-container').scrollTo({ left: state.scrollLeft, behavior: 'instant' });
  }
}

function setIdsforRTETitles(articleContentSection) {
  // find all titles with no id in the article content section
  articleContentSection
    .querySelectorAll('h1:not([id]),h2:not([id]),h3:not([id]),h4:not([id]),h5:not([id]),h6:not([id])')
    .forEach((title) => {
      title.id = title.textContent
        .toLowerCase()
        .trim()
        .replaceAll('[^a-z0-9-]', '-')
        .replaceAll('-{2,}', '-')
        .replaceAll('^-+', '')
        .replaceAll('-+$', '');
    });
}

// set the filter for an UE editable
function setUEFilter(element, filter) {
  element.dataset.aueFilter = filter;
}

function updateUEInstrumentation() {
  const main = document.querySelector('main');

  setUEFilter(main, 'page');

  // if we are on a template page
  if (document.body.hasAttribute('data-aem-template')) {
    const banner = document.createRange().createContextualFragment(`
      <div class='template-banner'>
        INFO: This is the initial content for template ${document.body.dataset.aemTemplate}
      </div`);
    document.body.append(banner);

    // show max available blocks on template
    document.body.dataset.aueModel = 'page-metadata';
  }

  // restrictions that apply when NOT EDITING the template itself
  if (!document.body.hasAttribute('data-aem-template')) {
    // EDS article pages limitations
    if (document.querySelector('body[class^=article]')) {
      main.querySelectorAll('.section').forEach((elem) => {
        setUEFilter(elem, 'article-section');
      });
    }
  }
}

async function applyChanges(event) {
  // redecorate default content and blocks on patches (in the properties rail)
  const { detail } = event;

  const resource = detail?.request?.target?.resource // update, patch components
    || detail?.request?.target?.container?.resource // update, patch, add to sections
    || detail?.request?.to?.container?.resource; // move in sections
  if (!resource) return false;
  const updates = detail?.response?.updates;
  if (!updates.length) return false;
  const { content } = updates[0];
  if (!content) return false;

  const parsedUpdate = new DOMParser().parseFromString(content, 'text/html');
  const element = document.querySelector(`[data-aue-resource="${resource}"]`);

  if (element) {
    if (element.matches('main')) {
      const newMain = parsedUpdate.querySelector(`[data-aue-resource="${resource}"]`);
      newMain.style.display = 'none';
      element.insertAdjacentElement('afterend', newMain);
      decorateMain(newMain);
      decorateRichtext(newMain);
      await loadSections(newMain);
      element.remove();
      newMain.style.display = null;
      // eslint-disable-next-line no-use-before-define
      attachEventListeners(newMain);
      return true;
    }

    const block = element.parentElement?.closest('.block[data-aue-resource]') || element?.closest('.block[data-aue-resource]');
    if (block) {
      const state = getState(block);
      const blockResource = block.getAttribute('data-aue-resource');
      const newBlock = parsedUpdate.querySelector(`[data-aue-resource="${blockResource}"]`);
      if (newBlock) {
        newBlock.style.display = 'none';
        block.insertAdjacentElement('afterend', newBlock);
        decorateButtons(newBlock);
        decorateIcons(newBlock);
        decorateBlock(newBlock);
        decorateRichtext(newBlock);
        await loadBlock(newBlock);
        block.remove();
        newBlock.style.display = null;
        restoreState(newBlock, state);
        return true;
      }
    } else {
      // sections and default content, may be multiple in the case of richtext
      const newElements = parsedUpdate.querySelectorAll(`[data-aue-resource="${resource}"],[data-richtext-resource="${resource}"]`);
      if (newElements.length) {
        const { parentElement } = element;
        if (element.matches('.section')) {
          const [newSection] = newElements;
          newSection.style.display = 'none';
          element.insertAdjacentElement('afterend', newSection);
          decorateButtons(newSection);
          decorateIcons(newSection);
          decorateRichtext(newSection);
          decorateSections(parentElement);
          decorateBlocks(parentElement);
          await loadSections(parentElement);
          element.remove();
          newSection.style.display = null;
        } else {
          element.replaceWith(...newElements);
          decorateButtons(parentElement);
          decorateIcons(parentElement);
          decorateRichtext(parentElement);
        }
        return true;
      }
    }
  }

  return false;
}

/**
 * Event listener for aue:ui-select, selection of a component
 */
function handleEditorSelect(event) {
  // we are only interested in the target
  if (!event.detail.selected) {
    return;
  }

  // if a tab panel was selected
  if (event.target.closest('.tabpanel')) {
    // switch to the selected tab
    const tabItem = event.target.closest('.tabpanel');
    // get the corresponding tabs button
    const buttonId = tabItem.getAttribute('aria-labelledby');
    const button = tabItem.closest('.tabs.block').querySelector(`button[id="${buttonId}"]`);
    // click it
    button.click();
  }
}

function attachEventListeners(main) {
  [
    'aue:content-patch',
    'aue:content-update',
    'aue:content-add',
    'aue:content-move',
    'aue:content-remove',
  ].forEach((eventType) => main?.addEventListener(eventType, async (event) => {
    event.stopPropagation();
    const applied = await applyChanges(event);
    if (applied) {
      updateUEInstrumentation();
    } else {
      window.location.reload();
    }
  }));

  main.addEventListener('aue:ui-select', handleEditorSelect);
}

attachEventListeners(document.querySelector('main'));

// update UE component filters on page load
updateUEInstrumentation();
