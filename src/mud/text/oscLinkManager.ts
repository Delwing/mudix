/**
 * Session-scoped state for stateful OSC 8 links — `selection` groups and
 * `:visited` tracking (Mudlet's selection manager + visited links).
 *
 * The styling itself is precomputed by the renderer and stashed on each link
 * element as `data-css-base` / `data-css-selected` / `data-css-visited`; this
 * manager only holds the *state* (which group values are selected, which links
 * have been activated) and re-applies the right stashed style to the live link
 * elements when state changes. Restyling queries the document, so it updates
 * every rendered run of a group across lines — not just the clicked one.
 */
export class OscLinkManager {
    /** group → set of currently-selected values. */
    private readonly selected = new Map<string, Set<string>>();
    /** Activated link keys (the command URI), for `:visited` styling. */
    private readonly visited = new Set<string>();

    isSelected(group: string, value: string): boolean {
        return this.selected.get(group)?.has(value) ?? false;
    }

    isVisited(key: string): boolean {
        return this.visited.has(key);
    }

    /**
     * Toggle `(group, value)` and return its new selected state. `exclusive`
     * groups behave like radio buttons (one value at a time); non-exclusive like
     * checkboxes (independent toggles).
     */
    toggleSelection(group: string, value: string, exclusive: boolean): boolean {
        let set = this.selected.get(group);
        if (!set) { set = new Set(); this.selected.set(group, set); }
        const willSelect = !set.has(value);
        if (exclusive) {
            set.clear();
            if (willSelect) set.add(value);
        } else if (willSelect) {
            set.add(value);
        } else {
            set.delete(value);
        }
        return set.has(value);
    }

    /** Seed an initially-selected value (server sent `selection.selected:true`). */
    select(group: string, value: string, exclusive: boolean): void {
        let set = this.selected.get(group);
        if (!set) { set = new Set(); this.selected.set(group, set); }
        if (exclusive) set.clear();
        set.add(value);
    }

    markVisited(key: string): void {
        if (key) this.visited.add(key);
    }

    /**
     * Re-apply the correct stashed style to every OSC link element under `root`,
     * based on current selection/visited state. Selection wins over visited.
     * No-op when `root` is null (e.g. a headless call with no DOM).
     */
    restyle(root: ParentNode | null | undefined): void {
        if (!root) return;
        const apply = (el: HTMLElement, css: string | undefined): void => {
            if (css !== undefined) el.style.cssText = css;
        };
        for (const el of root.querySelectorAll<HTMLElement>('[data-osc-group]')) {
            const group = el.dataset.oscGroup ?? '';
            const value = el.dataset.oscValue ?? '';
            if (this.isSelected(group, value)) apply(el, el.dataset.cssSelected);
            else if (el.dataset.oscVisit && this.isVisited(el.dataset.oscVisit) && el.dataset.cssVisited) {
                apply(el, el.dataset.cssVisited);
            } else {
                apply(el, el.dataset.cssBase);
            }
        }
        for (const el of root.querySelectorAll<HTMLElement>('[data-osc-visit]:not([data-osc-group])')) {
            if (this.isVisited(el.dataset.oscVisit ?? '')) apply(el, el.dataset.cssVisited);
        }
    }

    clear(): void {
        this.selected.clear();
        this.visited.clear();
    }
}
