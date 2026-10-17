/**
 * Where a floating editor goes so that it stays inside the scroll box.
 *
 * A decision module — nothing here touches the DOM, React or the platform, so
 * `dev/widths.js` loads it through `dev/modules.js` and asserts the arithmetic.
 * The lookup editor measures itself and the box when it opens and asks this
 * where to draw.
 *
 * **Why it is needed.** The lookup editor floats at its own width — a name, two
 * buttons and a cross, about 320px — from the start of a cell that is often a
 * third of that. In the view's last column it ran past the table's end, and
 * the scroll box counted that overhang as width to scroll: measured on the
 * test form 2026-10-17, a 112px Site cell opened a 320px editor, the box's
 * `scrollWidth` went 1,076 → 1,288, a horizontal scrollbar appeared, and the
 * focus the editor takes on opening scrolled the box all 212px — Chrome
 * centres an element that `focus()` has to scroll to, so it went to the end.
 * The whole table slid left and left a blank stretch after its last column.
 *
 * Slid back inside the box before the first paint, the same editor drew at
 * 771–1,091 in a 23–1,091 room, over the Engineer column, with the box's
 * `scrollWidth` still 1,076 and nothing scrolled.
 */

/** A horizontal extent in viewport pixels, as `getBoundingClientRect` gives it. */
export interface Extent {
    left: number;
    right: number;
}

export interface Fit {
    /** How far to move the editor, in pixels; negative is towards the left. */
    shift: number;
    /** The widest the editor may draw: the room, so a narrow box shrinks the name. */
    maxWidth: number;
}

/** The space kept between the editor and the box's edges. */
export const FIT_GAP = 4;

/**
 * Move an editor drawn at `editor` the least distance that puts it inside
 * `room`, keeping `gap` from each edge.
 *
 * In physical pixels, so it is the same answer in a right-to-left table: there
 * the editor starts at the cell's right and overhangs on the left, and the
 * clamp moves it right. An editor wider than the room is laid against the
 * room's left edge at the room's width; the name inside it is the part that
 * shrinks.
 */
export function fitInside(editor: Extent, room: Extent, gap: number = FIT_GAP): Fit {
    const start = room.left + gap;
    const end = room.right - gap;
    const maxWidth = Math.max(0, end - start);
    const width = Math.min(editor.right - editor.left, maxWidth);
    const left = Math.max(start, Math.min(editor.left, end - width));

    return { shift: Math.round(left - editor.left), maxWidth: Math.floor(maxWidth) };
}
