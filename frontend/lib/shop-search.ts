export const SHOP_SEARCH_EVENT = "wescomm-shop-search";

export function readShopSearchFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("query") ?? "";
}

export function writeShopSearchToUrl(value: string) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const trimmedValue = value.trim();

  if (trimmedValue) {
    params.set("query", trimmedValue);
  } else {
    params.delete("query");
  }

  const query = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
  );
}

export function emitShopSearch(value: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(SHOP_SEARCH_EVENT, { detail: value }));
}
