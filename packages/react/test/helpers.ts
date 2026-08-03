/**
 * Shared test helpers.
 *
 * <Shield> is a plain function component with no hooks, so tests call it
 * directly and inspect the React element tree it returns. That needs no
 * react-dom, no DOM environment, and no renderer — and it is the same tree
 * React would serialise, so assertions about DOM order and nesting hold.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";

/** Untyped prop access, for reading `aria-hidden` / `data-typeface` / etc. */
export function props(el: ReactElement): Record<string, unknown> {
  return el.props as Record<string, unknown>;
}

/** Every element in the tree, in pre-order — i.e. in DOM order. */
export function walkAll(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) walkAll(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node);
  walkAll(props(node).children as ReactNode, out);
  return out;
}

/** Elements strictly inside `el`. */
export function descendants(el: ReactElement): ReactElement[] {
  return walkAll(props(el).children as ReactNode);
}

/**
 * Like {@link walkAll}, but EXPANDS plain function components instead of
 * stopping at them.
 *
 * `walkAll` only ever descends through `props.children`, so a component that
 * renders a child component is a dead end: `<Shield wrapper>` returns a tree
 * containing `<NoticeStrip where="top">`, and everything the notice actually
 * puts on the page — the buttons, the sentence, the progress bar — lives
 * inside a function that `walkAll` never calls. Assertions written against
 * `walkAll` do not fail on that; they quietly find nothing and pass.
 *
 * Safe for the same reason the whole helpers file is: every component in this
 * package is a plain function of its props with no hooks and no context, so
 * calling one is exactly what React would do, minus the renderer.
 *
 * `skip` prunes a subtree and everything under it — used below to model
 * `aria-hidden`, which is the difference between what is RENDERED and what a
 * screen reader is handed.
 */
export function walkDeep(
  node: ReactNode,
  skip?: (el: ReactElement) => boolean,
  out: ReactElement[] = [],
): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) walkDeep(child, skip, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  if (typeof node.type === "function") {
    const made = (node.type as (p: unknown) => ReactNode)(node.props);
    return walkDeep(made, skip, out);
  }
  if (skip?.(node)) return out;
  out.push(node);
  walkDeep(props(node).children as ReactNode, skip, out);
  return out;
}

/** The encoded block: the one element carrying `aria-hidden="true"`. */
export function shieldedBlock(tree: ReactNode): ReactElement {
  // Identify the block by the camouflage data attribute, NOT by aria-hidden
  // alone. Several things in the tree are legitimately aria-hidden — the
  // progress bars, the status glyphs, the fallback paragraph — and "first
  // aria-hidden element" silently matched whichever of them happened to come
  // first in DOM order. When the clipped path's <progress> gained aria-hidden,
  // every assertion in weight.test.ts started reading that element's (absent)
  // style and failing with `undefined`, which looks like a component bug and
  // is not one. The data attribute is what actually marks the encoded block.
  // The encoded block is the only element whose camouflage attribute carries a
  // VARIANT NAME as its value (`data-typeface="alpha"`). Matching on the
  // attribute NAME is not enough — the progress bar, the output and the status
  // span all carry suffixed variants of it (`-bar`, `-out`, `-status`), and
  // several of them are legitimately aria-hidden too.
  const VARIANTS = ["alpha", "beta", "gamma", "maxhide"];
  const el = walkAll(tree).find(
    (e) =>
      props(e)["aria-hidden"] === "true" &&
      Object.entries(props(e)).some(
        ([k, v]) =>
          /^data-typeface(-[a-z0-9]+)?$/.test(k) &&
          typeof v === "string" &&
          VARIANTS.includes(v),
      ),
  );
  if (!el) throw new Error("no encoded block in the rendered tree");
  return el;
}

/** The variant <Shield> actually chose, read off the rendered data attribute. */
export function renderedVariant(tree: ReactNode): string {
  return props(shieldedBlock(tree))["data-typeface"] as string;
}

/**
 * First element of a given tag name.
 *
 * Walks with `walkDeep`, so a control that has been factored into a shared
 * subcomponent is still found. These used to use `walkAll`, and the day the
 * uncover button moved into <ActionButton> every assertion about it started
 * reading `undefined` — the tests were describing the shape of the source, not
 * the shape of the page.
 */
export function findTag(tree: ReactNode, tag: string): ReactElement | undefined {
  return walkDeep(tree).find((e) => e.type === tag);
}

/** All elements of a given tag name, in DOM order. */
export function findAllTags(tree: ReactNode, tag: string): ReactElement[] {
  return walkDeep(tree).filter((e) => e.type === tag);
}

/** Every string of visible text inside an element, joined — its rendered label. */
export function visibleText(el: ReactElement): string {
  const out: string[] = [];
  const eat = (n: ReactNode): void => {
    if (typeof n === "string" || typeof n === "number") out.push(String(n));
    else if (Array.isArray(n)) n.forEach(eat);
    else if (isValidElement(n)) eat(props(n).children as ReactNode);
  };
  eat(el);
  return out.join("").trim();
}
