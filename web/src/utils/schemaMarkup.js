/**
 * Schema.org markup builders for CardSync Pro (Electronic Valet).
 */

export function buildStoreSchema(settings = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: settings.storeName || 'Electronic Valet Inc',
    description:
      settings.description ||
      'Trading card game store offering Pokemon, Magic: The Gathering, Yu-Gi-Oh, and collectibles',
    ...(settings.address && {
      address: {
        '@type': 'PostalAddress',
        streetAddress: settings.address.street || '',
        addressLocality: settings.address.city || '',
        addressRegion: settings.address.state || '',
        postalCode: settings.address.zip || '',
        addressCountry: 'US',
      },
    }),
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        opens: '10:00',
        closes: '20:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Saturday'],
        opens: '10:00',
        closes: '18:00',
      },
    ],
    priceRange: '$$',
  };
}

const GAME_BRANDS = {
  pokemon: 'The Pokemon Company',
  magic: 'Wizards of the Coast',
  yugioh: 'Konami',
  onepiece: 'Bandai',
};

export function buildProductSchema(card, storeName = 'Electronic Valet Inc') {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: card.name,
    description: [card.game, card.card_set, card.condition].filter(Boolean).join(' — '),
  };

  if (card.image_url) {
    schema.image = card.image_url;
  }

  const brandName = GAME_BRANDS[card.game] || card.game;
  if (brandName) {
    schema.brand = { '@type': 'Brand', name: brandName };
  }

  if (card.sell_price != null) {
    schema.offers = {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: String(card.sell_price),
      availability:
        card.quantity > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: storeName },
    };
  }

  return schema;
}

export function buildOfferSchema(card, buyPrice, storeName = 'Electronic Valet Inc') {
  return {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    itemOffered: {
      '@type': 'Product',
      name: card.name,
    },
    price: String(buyPrice),
    priceCurrency: 'USD',
    seller: {
      '@type': 'Store',
      name: storeName,
    },
  };
}

export function buildProductListSchemas(cards, storeName) {
  return cards.slice(0, 50).map((card) => buildProductSchema(card, storeName));
}
