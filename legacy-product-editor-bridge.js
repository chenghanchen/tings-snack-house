/* Preserve the original full product editor while the grouped category UI replaces its visible button. */
(() => {
  const original = document.querySelector("#newProduct");
  if (!original) return;
  const surrogate = original.cloneNode(true);
  original.id = "legacyNewProduct";
  original.hidden = true;
  original.parentElement.insertBefore(surrogate, original);
  const openForCategory = (category) => {
    original.click();
    setTimeout(() => {
      const select = document.querySelector("#productType");
      if (select) {
        select.value = category;
        select.dispatchEvent(new Event("change"));
      }
    }, 280);
  };
  const editProduct = (id) => {
    const legacy = document.querySelector(
      `#productsList [data-edit="${CSS.escape(String(id))}"]`,
    );
    if (legacy) legacy.click();
  };
  document.addEventListener(
    "click",
    (event) => {
      const add = event.target.closest?.("[data-category-add-product]");
      if (add) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openForCategory(add.dataset.categoryAddProduct || "未分类");
        return;
      }
      const edit = event.target.closest?.("[data-managed-edit]");
      if (edit) {
        event.preventDefault();
        event.stopImmediatePropagation();
        editProduct(edit.dataset.managedEdit);
      }
    },
    true,
  );
})();
