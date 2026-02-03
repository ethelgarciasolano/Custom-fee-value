export default function AdditionalPage() {
  return (
    <s-page heading="Instructions — Custom Fee (Plus)">
      <s-section heading="What does this app do?">
        <s-paragraph>
          This app automatically adds a “Fee” product to checkout and adjusts
          its price based on percentage rules defined in the Checkout block.
  
        </s-paragraph>
      </s-section>

      <s-section heading="Step 1 — Create the Fee product from the app">
        <s-paragraph>
          On the main app page, click <strong>Create product + variant</strong>.
          This will create a product (for example, “Service fee”) with a variant
          (for example, “Fee”), publish it, and store the Variant GID in the
          shop metafields.
        </s-paragraph>
        <s-paragraph>
          Important: if you manually delete the product or variant from the
          Shopify Admin, return to this app and create a new one (or clear the
          saved reference if available).
        </s-paragraph>
      </s-section>

      <s-section heading="Step 2 — Configure the block in Checkout Editor">
        <s-paragraph>
          Go to <strong>Settings → Checkout → Customize</strong> (Checkout
          Editor), add the app block, and configure the following fields:
        </s-paragraph>

        <s-unordered-list>
          <s-list-item>
            <strong>Fee Variant GID:</strong> paste the variant identifier. You
            can paste the full GID (
            <code>gid://shopify/ProductVariant/...</code>) or just the numeric
            ID — the extension will normalize it automatically.
          </s-list-item>
          <s-list-item>
            <strong>Message title</strong> and <strong>Message body:</strong>{" "}
            displayed to the customer in checkout.
          </s-list-item>
          <s-list-item>
            <strong>Rules by range (percentage):</strong> one rule per line,
            using the format <code>MIN-MAX=PERCENT%</code>.
          </s-list-item>
        </s-unordered-list>

        <s-paragraph>
          Example rules:
          <br />
          <code>
            0-200000=10%<br />
            200001-500000=7%<br />
            500001-999999999=3%
          </code>
        </s-paragraph>
      </s-section>

    <s-section heading="Step 3 — How is the Fee added to the cart?">
  <s-paragraph>
    When a customer reaches checkout, the app automatically manages the fee for
    the order.
  </s-paragraph>

  <s-unordered-list>
    <s-list-item>
      The app automatically adds the fee to the cart if it is not already
      present.
    </s-list-item>
    <s-list-item>
      If the fee is already in the cart, the app ensures it is applied only once.
    </s-list-item>
  </s-unordered-list>

  <s-paragraph>
    If the fee does not appear in checkout, make sure the fee product exists in
    your store and is active and published.
  </s-paragraph>
</s-section>

<s-section heading="Step 4 — How is the Fee calculated?">
  <s-paragraph>
    The fee amount is calculated automatically based on the total value of the
    cart.
  </s-paragraph>

  <s-unordered-list>
    <s-list-item>
      The app reviews the cart total before the fee is applied.
    </s-list-item>
    <s-list-item>
      It selects the correct percentage according to the configured rules.
    </s-list-item>
  </s-unordered-list>

  <s-paragraph>
    The fee is then updated in real time during checkout, ensuring customers
    always see the correct additional charge.
  </s-paragraph>
</s-section>


      <s-section heading="Quick verification checklist">
        <s-unordered-list>
          <s-list-item>
            The Fee product is <strong>ACTIVE</strong> and published.
          </s-list-item>
          <s-list-item>
            The Checkout block has the <strong>Fee Variant GID</strong> correctly
            configured.
          </s-list-item>
          <s-list-item>
            Rules follow the correct format: <code>MIN-MAX=PERCENT%</code>.
          </s-list-item>
          <s-list-item>
            The message block is visible in checkout and the Fee line is added.
          </s-list-item>
        </s-unordered-list>
      </s-section>

<s-section slot="aside" heading="Resources">
  <s-unordered-list>


    <s-list-item>
      For support inquiries, please contact{" "}
      <s-link href="mailto:help@nexonixcore.com">
       help@nexonixcore.com
      </s-link>
      .
    </s-list-item>
  </s-unordered-list>
</s-section>
    </s-page>
  );
}
