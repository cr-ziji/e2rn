async function init() {
  const res = await window.api.ping();
  console.log(res);
}
init();
