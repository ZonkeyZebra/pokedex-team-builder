export function getAuthRedirectUrl(path = "") {
  const relativePath = path.replace(/^\/+/, "");
  return new URL(`${import.meta.env.BASE_URL}${relativePath}`, window.location.origin).toString();
}
