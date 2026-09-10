import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("商品排版：现价与按钮双端一致，普通卡按内容收缩", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const shared = css.slice(css.indexOf("/* Shared compact catalog controls."));
  assert.match(shared, /#productGrid \.product-price-wrap b,#productGrid \.product-price-wrap \.sale-price\{font-size:20px\}/);
  assert.match(shared, /#productGrid \.add\{padding-left:8px;padding-right:8px\}/);
  assert.match(shared, /:not\(:has\(\.has-promotion,\.has-stock-notice\)\)\{min-height:0;align-self:start\}/);
  assert.match(shared, /#productSearch\{margin-top:-30px\}/);
  assert.match(shared, /#deliveryInfo\{margin-top:-50px;margin-bottom:0\}/);
  assert.match(shared, /@media\(max-width:780px\)\{\s*#snacks\{padding-top:21px\}/);
});
