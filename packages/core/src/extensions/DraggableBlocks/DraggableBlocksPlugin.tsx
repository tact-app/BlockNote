import { NodeSelection, Plugin, PluginKey } from "prosemirror-state";
import * as pv from "prosemirror-view";
import { EditorView } from "prosemirror-view";
import ReactDOM from "react-dom";
import { DragHandle } from "./components/DragHandle";

const serializeForClipboard = (pv as any).__serializeForClipboard;
// code based on https://github.com/ueberdosis/tiptap/issues/323#issuecomment-506637799

let firstBlockGroup: HTMLElement | undefined;
function getHorizontalAnchor() {
  if (!firstBlockGroup) {
    firstBlockGroup = document.querySelector(
      ".ProseMirror > [class*='blockGroup']"
    ) as HTMLElement | undefined; // first block group node
  }

  if (firstBlockGroup) {
    return absoluteRect(firstBlockGroup).left;
  }

  return 0;
}

export function createRect(rect: DOMRect) {
  let newRect = {
    left: rect.left + document.body.scrollLeft,
    top: rect.top + document.body.scrollTop,
    width: rect.width,
    height: rect.height,
    bottom: 0,
    right: 0,
  };
  newRect.bottom = newRect.top + newRect.height;
  newRect.right = newRect.left + newRect.width;
  return newRect;
}

export function absoluteRect(element: HTMLElement) {
  return createRect(element.getBoundingClientRect());
}

function blockPosAtCoords(
  coords: { left: number; top: number },
  view: EditorView
) {
  let block = getDraggableBlockFromCoords(coords, view);

  if (block && block.node.nodeType === 1) {
    // TODO: this uses undocumented PM APIs? do we need this / let's add docs?
    const docView = (view as any).docView;
    let desc = docView.nearestDesc(block.node, true);
    if (!desc || desc === docView) {
      return null;
    }
    return desc.posBefore;
  }
  return null;
}

function getDraggableBlockFromCoords(
  coords: { left: number; top: number },
  view: EditorView
) {
  let pos = view.posAtCoords(coords);
  if (!pos) {
    return undefined;
  }
  let node = view.domAtPos(pos.pos).node as HTMLElement;

  if (node === view.dom) {
    // mouse over root
    return undefined;
  }

  while (
    node &&
    node.parentNode &&
    node.parentNode !== view.dom &&
    !node.hasAttribute?.("data-id")
  ) {
    node = node.parentNode as HTMLElement;
  }
  if (!node) {
    return undefined;
  }
  return { node, id: node.getAttribute("data-id")! };
}

function dragStart(e: DragEvent, view: EditorView) {
  if (!e.dataTransfer) {
    return;
  }

  const bound = view.dom.getBoundingClientRect();
  let coords = {
    left: bound.left + bound.width / 2, // take middle of editor
    top: e.clientY,
  };
  let pos = blockPosAtCoords(coords, view);
  if (pos != null) {
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
    );

    let slice = view.state.selection.content();
    let { dom, text } = serializeForClipboard(view, slice);

    e.dataTransfer.clearData();
    e.dataTransfer.setData("text/html", dom.innerHTML);
    e.dataTransfer.setData("text/plain", text);
    e.dataTransfer.effectAllowed = "move";
    const block = getDraggableBlockFromCoords(coords, view);
    e.dataTransfer.setDragImage(block?.node as any, 0, 0);
    view.dragging = { slice, move: true };
  }
}


// When true, the drag handle with be anchored at the same level as root elements
// When false, the drag handle with be just to the left of the element
const horizontalPosAnchoredAtRoot = true;
const WIDTH = 48;

const setDragHandlerLeftPosition = (rectLeft: number, dropElement: HTMLElement, win: (Window & typeof globalThis) | null) => {
  const left =
    (horizontalPosAnchoredAtRoot ? getHorizontalAnchor() : rectLeft) -
    WIDTH +
    (win?.pageXOffset || 0);

  dropElement.style.left = left + "px";
}

export const createDraggableBlocksPlugin = () => {
  let dropElement: HTMLElement | undefined;

  let menuShown = false;
  let addClicked = false;

  const onShow = () => {
    menuShown = true;
  };
  const onHide = () => {
    menuShown = false;
  };
  const onAddClicked = () => {
    addClicked = true;
  };

  return new Plugin({
    key: new PluginKey("DraggableBlocksPlugin"),
    view(editorView) {
      dropElement = document.createElement("div");
      dropElement.setAttribute("draggable", "true");
      dropElement.style.position = "absolute";
      dropElement.style.zIndex = "10000";
      dropElement.style.height = "24px"; // default height
      document.body.append(dropElement);

      dropElement.addEventListener("dragstart", (e) =>
        dragStart(e, editorView)
      );

      new ResizeObserver(() => {
        if (firstBlockGroup && dropElement) {
          setDragHandlerLeftPosition(
            absoluteRect(firstBlockGroup).left,
            dropElement as HTMLElement,
            editorView.dom.ownerDocument.defaultView
          );
        }
      }).observe(editorView.dom);

      return {
        // update(view, prevState) {},
        destroy() {
          if (!dropElement) {
            throw new Error("unexpected");
          }
          dropElement.parentNode!.removeChild(dropElement);
          dropElement = undefined;
        },
      };
    },
    props: {
      // handleDOMEvents: {

      // },
      //   handleDOMEvents: {
      //     dragend(view, event) {
      //       //   setTimeout(() => {
      //       //     let node = document.querySelector(".ProseMirror-hideselection");
      //       //     if (node) {
      //       //       node.classList.remove("ProseMirror-hideselection");
      //       //     }
      //       //   }, 50);
      //       return true;
      //     },
      handleKeyDown(_view, _event) {
        if (!dropElement) {
          throw new Error("unexpected");
        }
        menuShown = false;
        addClicked = false;
        ReactDOM.render(<></>, dropElement);
        return false;
      },
      handleDOMEvents: {
        // drag(view, event) {
        //   // event.dataTransfer!.;
        //   return false;
        // },
        mouseleave(_view, _event: any) {
          if (!dropElement) {
            throw new Error("unexpected");
          }
          // TODO
          // dropElement.style.display = "none";
          return true;
        },
        mousedown(_view, _event: any) {
          if (!dropElement) {
            throw new Error("unexpected");
          }
          menuShown = false;
          addClicked = false;
          ReactDOM.render(<></>, dropElement);
          return false;
        },
        mousemove(view, event: any) {
          if (!dropElement) {
            throw new Error("unexpected");
          }

          if (menuShown || addClicked) {
            // The submenu is open, don't move draghandle
            // Or if the user clicked the add button
            return true;
          }

          const bound = view.dom.getBoundingClientRect();
          const coords = {
            left: bound.left + bound.width / 2, // take middle of editor
            top: event.clientY,
          };
          const block = getDraggableBlockFromCoords(coords, view);

          if (!block) {
            console.warn("Perhaps we should hide element?");
            return true;
          }

          // I want the dim of the blocks content node
          // because if the block contains other blocks
          // Its dims change, moving the position of the drag handle
          const blockContent = block.node.firstChild as HTMLElement;

          if (!blockContent) {
            return true;
          }

          const rect = absoluteRect(blockContent);
          const win = block.node.ownerDocument.defaultView!;
          const dropElementRect = dropElement.getBoundingClientRect();
          rect.top +=
            rect.height / 2 - dropElementRect.height / 2 + win.pageYOffset;

          dropElement.style.top = rect.top + "px";
          setDragHandlerLeftPosition(rect.left, dropElement, win);

          ReactDOM.render(
            <DragHandle
              onShow={onShow}
              onHide={onHide}
              onAddClicked={onAddClicked}
              key={block.id + ""}
              view={view}
              coords={coords}
            />,
            dropElement
          );
          return true;
        },
      },
    },
  });
};
