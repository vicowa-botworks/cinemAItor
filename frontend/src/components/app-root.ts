import {
  css,
  html,
  LitElement,
} from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-element/lit-element.ts";
import { customElement, state } from "lit/decorators.ts";

@customElement("app-root")
export class AppRoot extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }
  `;

  override render() {
    return html`
      <div class="app">
        <h1>CinemaItor</h1>
        <p>Loading...</p>
      </div>
    `;
  }
}
