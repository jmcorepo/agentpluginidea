/** Synthetic local fixtures only; this is not live provider data or selector evidence. */
export const fixtureRideRequest = { pickup: '123 Main Street, Chicago IL 60601', destination: '456 Oak Road, Chicago IL 60602', passengers: 2 };

export interface RideFixtureOptions {
  category?: string; capacity?: number; mismatchedRoute?: boolean; hideSummary?: boolean;
  login?: boolean; currency?: string; wrongAutocomplete?: boolean; shared?: boolean;
  totalCents?: number; keepOldFare?: boolean; delayPriceMs?: number; neverRefreshFare?: boolean;
  editableSummary?: boolean;
}
export function createRideFixture(provider: 'uber' | 'lyft', options: RideFixtureOptions = {}): string {
  if (options.login) return '<h1>Sign in to continue</h1><button>Sign in</button>';
  const config = JSON.stringify({ category: provider === 'uber' ? 'UberX' : 'Standard', capacity: 4, currency: 'USD ', totalCents: 1925, ...options });
  return `<!doctype html><html><body>
    <h1>Plan your ride</h1>
    <form id="route-form">
      <label>Pickup location<input id="pickup" role="combobox" autocomplete="off"></label>
      <label>Destination<input id="destination" role="combobox" autocomplete="off"></label>
      <button type="submit">See prices</button>
    </form>
    <div id="quotes"><div id="summary"></div><section id="prices" aria-label="Ride options"></section><div id="booking"></div></div>
    <script>
      const config = ${config};
      window.fixtureEvents = { addresses: [], searches: 0, bookings: 0 };
      const resolved = {};
      function renderFare(totalCents) {
        const prices = document.getElementById('prices'); prices.replaceChildren();
        const card = document.createElement('div');
        for (const text of [config.category, config.capacity + ' passengers', config.shared ? 'Shared ride' : 'Private ride', 'Pickup in 4 min', 'Arrive at destination in 23 min', config.currency + '$' + (totalCents / 100).toFixed(2)]) {
          const line = document.createElement('div'); line.textContent = text; card.append(line);
        }
        prices.append(card); prices.setAttribute('aria-busy', 'false');
      }
      if (config.keepOldFare) renderFare(5460);
      for (const id of ['pickup', 'destination']) {
        const input = document.getElementById(id);
        input.addEventListener('input', () => {
          document.querySelectorAll('[role=listbox]').forEach(el => el.remove());
          const list = document.createElement('div'); list.setAttribute('role', 'listbox');
          const option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'option');
          option.textContent = config.wrongAutocomplete ? 'Unknown place' : input.value;
          option.addEventListener('click', () => {
            resolved[id] = option.textContent;
            window.fixtureEvents.addresses.push({ field: id, value: resolved[id] });
            list.remove();
          });
          list.append(option); input.after(list);
        });
      }
      document.getElementById('route-form').addEventListener('submit', event => {
        event.preventDefault(); window.fixtureEvents.searches++;
        if (!resolved.pickup || !resolved.destination) return;
        const summaryContainer = document.getElementById('summary'); summaryContainer.replaceChildren();
        if (!config.hideSummary) {
          const summary = document.createElement('section'); summary.setAttribute('aria-label', 'Route summary');
          const pickup = document.createElement('div'); pickup.textContent = 'Pickup: ' + resolved.pickup;
          const destination = document.createElement('div'); destination.textContent = 'Destination: ' + (config.mismatchedRoute ? '999 Wrong Avenue, Chicago IL 60603' : resolved.destination);
          summary.append(pickup, destination);
          if (config.editableSummary) summary.setAttribute('contenteditable', 'true');
          summaryContainer.append(summary);
        }
        document.getElementById('prices').setAttribute('aria-busy', 'true');
        if (!config.neverRefreshFare) {
          if (config.delayPriceMs) setTimeout(() => renderFare(config.totalCents), config.delayPriceMs);
          else renderFare(config.totalCents);
        }
        const booking = document.getElementById('booking'); booking.replaceChildren();
        const book = document.createElement('button'); book.textContent = 'Request ${provider === 'uber' ? 'UberX' : 'Lyft'}';
        book.addEventListener('click', () => window.fixtureEvents.bookings++); booking.append(book);
      });
    </script></body></html>`;
}
