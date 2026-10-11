/* eslint-disable */
'use strict';
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === 'object') || typeof from === 'function') {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = (mod) =>
  __copyProps(__defProp({}, '__esModule', { value: true }), mod);

// upstream/sdk.ts
var sdk_exports = {};
__export(sdk_exports, {
  GetUserMealImagesOptionsSchema: () => GetUserMealImagesOptionsSchema,
  UserMealImagesSchema: () => UserMealImagesSchema,
  Yazio: () => Yazio,
  YazioAuth: () => YazioAuth,
  addUserConsumedItem: () => addUserConsumedItem,
  deleteUserRecipe: () => deleteUserRecipe,
  fetchYazio: () => fetchYazio,
  getProduct: () => getProduct,
  getRecipe: () => getRecipe,
  getTokenFromCredentials: () => getTokenFromCredentials,
  getTokenFromRefreshToken: () => getTokenFromRefreshToken,
  getUser: () => getUser,
  getUserConsumedItems: () => getUserConsumedItems,
  getUserDailySummary: () => getUserDailySummary,
  getUserDietaryPreferences: () => getUserDietaryPreferences,
  getUserExercises: () => getUserExercises,
  getUserGoals: () => getUserGoals,
  getUserMealImages: () => getUserMealImages,
  getUserRecipeIds: () => getUserRecipeIds,
  getUserSettings: () => getUserSettings,
  getUserSuggestedProducts: () => getUserSuggestedProducts,
  getUserWaterIntake: () => getUserWaterIntake,
  getUserWeight: () => getUserWeight,
  removeUserConsumedItem: () => removeUserConsumedItem,
  searchProducts: () => searchProducts,
});
module.exports = __toCommonJS(sdk_exports);

// upstream/src/utils/constants.ts
var YAZIO_BASE_URL = 'https://yzapi.yazio.com/v20';
var YAZIO_OAUTH_URL = 'https://yzapi.yazio.com/v22/oauth/token';
var YAZIO_USER_AGENT =
  'YAZIO/26.30.1 (com.yazio.ios.YAZIO; build:2607271240; iOS 27.0.0) Ktor';
var YAZIO_CLIENT_ID = '3_5rbw4kehpugw8ogsc8ck8oo4ogswgckcskc04gcg8kk8k48ssw';
var YAZIO_CLIENT_SECRET = '25gdtt1hvdi8gwowoww4oo88sgsw0oo04o0og0kkgwwks8k0k';

// upstream/src/utils/fetch.ts
var fetchYazio = (input, init) => {
  const headers = new Headers(init?.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', YAZIO_USER_AGENT);
  return fetch(
    typeof input === 'string' && !input.startsWith('http')
      ? `${YAZIO_BASE_URL}${input}`
      : input,
    { ...init, headers },
  ).then((res) => {
    if (!res.ok)
      throw new Error(
        `Error fetching \`${input}\`. (${res.status} ${res.statusText})`,
      );
    if (res.status === 204) return Promise.resolve();
    return res.json();
  });
};

// upstream/src/api/oauth/token.ts
var getTokenFromCredentials = async (credentials) => {
  const { username, password } = credentials;
  if (!username || !password)
    throw new Error(
      'Incomplete or missing credentials provided. Either `username` or `password` are missing.',
    );
  const token = await fetchYazio(YAZIO_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: YAZIO_CLIENT_ID,
      client_secret: YAZIO_CLIENT_SECRET,
      username,
      password,
      grant_type: 'password',
    }),
  });
  return {
    ...token,
    expires_at: Date.now() + token.expires_in * 1e3,
  };
};
var getTokenFromRefreshToken = async (refreshToken) => {
  if (!refreshToken) throw new Error('Missing refresh_token. Cannot refresh.');
  const token = await fetchYazio(YAZIO_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: YAZIO_CLIENT_ID,
      client_secret: YAZIO_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  return {
    ...token,
    expires_at: Date.now() + token.expires_in * 1e3,
  };
};

// upstream/src/types/auth.ts
var import_zod = require('zod');
var TokenSchema = import_zod.z.object({
  token_type: import_zod.z.string(),
  access_token: import_zod.z.string(),
  refresh_token: import_zod.z.string(),
  expires_in: import_zod.z.number(),
  expires_at: import_zod.z.number(),
});
var TokenResolverSchema = import_zod.z.union([
  TokenSchema,
  import_zod.z
    .function()
    .returns(
      import_zod.z.union([
        TokenSchema,
        import_zod.z.promise(
          import_zod.z.union([TokenSchema, import_zod.z.null()]),
        ),
        import_zod.z.null(),
      ]),
    ),
]);
var CredentialsSchema = import_zod.z.object({
  username: import_zod.z.string(),
  password: import_zod.z.string(),
});
var CredentialsResolverSchema = import_zod.z.union([
  CredentialsSchema,
  import_zod.z.promise(CredentialsSchema),
  import_zod.z
    .function()
    .returns(
      import_zod.z.union([
        CredentialsSchema,
        import_zod.z.promise(
          import_zod.z.union([CredentialsSchema, import_zod.z.null()]),
        ),
        import_zod.z.null(),
      ]),
    ),
  import_zod.z.promise(CredentialsSchema),
]);
var RefreshHandlerSchema = import_zod.z
  .function()
  .args(import_zod.z.object({ token: TokenSchema }))
  .returns(import_zod.z.any());
var YazioAuthInitSchema = import_zod.z.union([
  import_zod.z.object({
    credentials: CredentialsResolverSchema,
    token: import_zod.z.undefined(),
    onRefresh: RefreshHandlerSchema.optional(),
  }),
  import_zod.z.object({
    credentials: import_zod.z.undefined(),
    token: TokenResolverSchema,
    onRefresh: RefreshHandlerSchema.optional(),
  }),
  import_zod.z.object({
    credentials: CredentialsResolverSchema,
    token: TokenResolverSchema,
    onRefresh: RefreshHandlerSchema.optional(),
  }),
]);

// upstream/src/auth.ts
var resolveCredentials = async (credentials) => {
  if (typeof credentials === 'function') {
    const result = credentials();
    return result instanceof Promise ? await result : result;
  } else if (credentials instanceof Promise) {
    return await credentials;
  } else {
    return credentials || null;
  }
};
var resolveToken = async (token) => {
  if (typeof token === 'function') {
    const result = token();
    return result instanceof Promise ? await result : result;
  } else if (token instanceof Promise) {
    return await token;
  } else {
    return token || null;
  }
};
var YazioAuth = class {
  token = null;
  credentials = null;
  cachedToken = null;
  onRefresh = null;
  /**
   * Get a valid token pair for the current session.
   *
   * @returns - Promise resolving to a Token object containing the key pairs.
   */
  authenticate = async () => {
    if (this.cachedToken && this.cachedToken.expires_at > Date.now())
      return this.cachedToken;
    const token = await resolveToken(this.token);
    if (token && token.expires_at > Date.now()) {
      this.cachedToken = token;
      return token;
    }
    const tokenToRefresh = token ?? this.cachedToken;
    if (tokenToRefresh?.refresh_token) {
      try {
        const refreshedToken2 = await getTokenFromRefreshToken(
          tokenToRefresh.refresh_token,
        );
        this.cachedToken = refreshedToken2;
        this.token = refreshedToken2;
        if (this.onRefresh) this.onRefresh({ token: refreshedToken2 });
        return refreshedToken2;
      } catch {}
    }
    const credentials = await resolveCredentials(this.credentials);
    if (!credentials)
      throw new Error(
        'Unable to resolve credentials. Please make sure `credentials` is passed correctly.',
      );
    const refreshedToken = await getTokenFromCredentials(credentials);
    this.cachedToken = refreshedToken;
    this.token = refreshedToken;
    if (this.onRefresh) this.onRefresh({ token: refreshedToken });
    return refreshedToken;
  };
  constructor(init) {
    const res = YazioAuthInitSchema.safeParse(init);
    if (!res.success)
      throw new Error(
        `Could not parse given YazioAuthInit object. Please make sure it is in the correct format.`,
      );
    if (res.data.token) this.token = res.data.token;
    if (res.data.credentials) this.credentials = res.data.credentials;
    if (res.data.onRefresh) this.onRefresh = res.data.onRefresh;
  }
};

// upstream/src/api/products/index.ts
var import_zod2 = require('zod');
var NutrientsSchema = import_zod2.z.object({
  'energy.energy': import_zod2.z.number(),
  'mineral.calcium': import_zod2.z.number(),
  'mineral.chlorine': import_zod2.z.number(),
  'mineral.copper': import_zod2.z.number(),
  'mineral.fluorine': import_zod2.z.number(),
  'mineral.iron': import_zod2.z.number(),
  'mineral.magnesium': import_zod2.z.number(),
  'mineral.manganese': import_zod2.z.number(),
  'mineral.phosphorus': import_zod2.z.number(),
  'mineral.potassium': import_zod2.z.number(),
  'mineral.sulfur': import_zod2.z.number(),
  'mineral.zinc': import_zod2.z.number(),
  'nutrient.carb': import_zod2.z.number(),
  'nutrient.dietaryfiber': import_zod2.z.number(),
  'nutrient.fat': import_zod2.z.number(),
  'nutrient.protein': import_zod2.z.number(),
  'nutrient.sugar': import_zod2.z.number(),
  'vitamin.a': import_zod2.z.number(),
  'vitamin.b1': import_zod2.z.number(),
  'vitamin.b12': import_zod2.z.number(),
  'vitamin.b2': import_zod2.z.number(),
  'vitamin.b6': import_zod2.z.number(),
  'vitamin.d': import_zod2.z.number(),
  'vitamin.e': import_zod2.z.number(),
});
var ServingSchema = import_zod2.z.object({
  serving: import_zod2.z.string(),
  amount: import_zod2.z.number().positive(),
});
var ProductSchema = import_zod2.z.object({
  id: import_zod2.z.string().uuid(),
  name: import_zod2.z.string(),
  is_verified: import_zod2.z.boolean(),
  is_private: import_zod2.z.boolean(),
  is_deleted: import_zod2.z.boolean(),
  has_ean: import_zod2.z.boolean(),
  category: import_zod2.z.string(),
  producer: import_zod2.z.string().nullable(),
  nutrients: NutrientsSchema,
  updated_at: import_zod2.z.string(),
  servings: import_zod2.z.array(ServingSchema),
  base_unit: import_zod2.z.string(),
  eans: import_zod2.z.array(import_zod2.z.string()),
  language: import_zod2.z.string(),
  countries: import_zod2.z.array(import_zod2.z.string()),
});
var getProduct = async (token, id) =>
  fetchYazio(`/products/${id}`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  }).then((product) => (product ? { ...product, id } : null));

// upstream/src/api/products/search.ts
var import_zod3 = require('zod');
var SearchProductOptionsSchema = import_zod3.z.object({
  query: import_zod3.z.string(),
  sex: import_zod3.z
    .union([import_zod3.z.literal('male'), import_zod3.z.literal('female')])
    .optional(),
  countries: import_zod3.z.array(import_zod3.z.string().length(2)).optional(),
  locales: import_zod3.z.array(import_zod3.z.string().length(5)).optional(),
});
var BasicNutrientsSchema = import_zod3.z.object({
  'energy.energy': import_zod3.z.number(),
  'nutrient.carb': import_zod3.z.number(),
  'nutrient.protein': import_zod3.z.number(),
  'nutrient.fat': import_zod3.z.number(),
});
var ProductSearchResultSchema = import_zod3.z.object({
  score: import_zod3.z.number(),
  name: import_zod3.z.string(),
  product_id: import_zod3.z.string().uuid(),
  serving: import_zod3.z.string(),
  serving_quantity: import_zod3.z.number().positive(),
  amount: import_zod3.z.number().positive(),
  base_unit: import_zod3.z.string(),
  producer: import_zod3.z.string(),
  is_verified: import_zod3.z.boolean(),
  nutrients: BasicNutrientsSchema,
  countries: import_zod3.z.array(import_zod3.z.string()),
  language: import_zod3.z.string(),
});
var searchProducts = async (token, options) => {
  const queryParams = new URLSearchParams({
    query: options.query,
    sex: options.sex ?? 'male',
    countries: (options.countries ?? ['DE', 'US']).join(','),
    locales: (options.locales ?? ['en_US', 'de_US']).join(','),
  });
  return fetchYazio(`/products/search?${queryParams}`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });
};

// upstream/src/types/yazio.ts
var import_zod4 = require('zod');
var DaytimeSchema = import_zod4.z.enum([
  'breakfast',
  'lunch',
  'dinner',
  'snack',
]);

// upstream/src/utils/date.ts
var parseDate = (input) => {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toISOString().split('T')[0];
};

// upstream/src/api/user/consumed.ts
var import_zod5 = require('zod');
var GetUserConsumedItemsOptionsSchema = import_zod5.z.object({
  date: import_zod5.z
    .union([import_zod5.z.date(), import_zod5.z.string()])
    .optional(),
});
var UserConsumedItemSchema = import_zod5.z.object({
  id: import_zod5.z.string().uuid(),
  date: import_zod5.z.string(),
  daytime: DaytimeSchema,
  type: import_zod5.z.string(),
  product_id: import_zod5.z.string().uuid(),
  amount: import_zod5.z.number().positive(),
  serving: import_zod5.z.string().nullable(),
  serving_quantity: import_zod5.z.number().nullable(),
});
var RecipePortionConsumedItemSchema = import_zod5.z.object({
  id: import_zod5.z.string().uuid(),
  date: import_zod5.z.string(),
  daytime: DaytimeSchema,
  type: import_zod5.z.literal('recipe_portion'),
  recipe_id: import_zod5.z.string().uuid(),
  portion_count: import_zod5.z.number(),
});
var SimpleProductConsumedItemSchema = import_zod5.z.object({
  id: import_zod5.z.string().uuid(),
  date: import_zod5.z.string(),
  daytime: DaytimeSchema,
  type: import_zod5.z.literal('simple_product'),
  name: import_zod5.z.string(),
  nutrients: import_zod5.z.record(
    import_zod5.z.string(),
    import_zod5.z.number(),
  ),
  is_ai_generated: import_zod5.z.boolean(),
});
var GetUserConsumedItemsResponseSchema = import_zod5.z.object({
  products: import_zod5.z.array(UserConsumedItemSchema),
  recipe_portions: import_zod5.z.array(RecipePortionConsumedItemSchema),
  simple_products: import_zod5.z.array(SimpleProductConsumedItemSchema),
});
var getUserConsumedItems = async (token, options) =>
  fetchYazio(
    `/user/consumed-items?date=${parseDate(options?.date ?? /* @__PURE__ */ new Date())}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
  );
var AddUserConsumedItemsOptionsSchema = import_zod5.z.union([
  import_zod5.z.object({
    id: import_zod5.z.string().uuid(),
    product_id: import_zod5.z.string().uuid(),
    date: import_zod5.z.union([import_zod5.z.date(), import_zod5.z.string()]),
    daytime: DaytimeSchema,
    amount: import_zod5.z.number(),
    serving: import_zod5.z.string(),
    serving_quantity: import_zod5.z.number(),
  }),
  import_zod5.z.object({
    id: import_zod5.z.string().uuid(),
    product_id: import_zod5.z.string().uuid(),
    date: import_zod5.z.union([import_zod5.z.date(), import_zod5.z.string()]),
    daytime: DaytimeSchema,
    amount: import_zod5.z.number(),
    serving: import_zod5.z.null(),
    serving_quantity: import_zod5.z.null(),
  }),
]);
var addUserConsumedItem = async (token, entry) =>
  await fetchYazio('/user/consumed-items', {
    method: 'POST',
    body: JSON.stringify({
      recipe_portions: [],
      simple_products: [],
      products: [
        {
          id: entry.id,
          product_id: entry.product_id,
          date: parseDate(entry.date ?? /* @__PURE__ */ new Date()),
          daytime: entry.daytime,
          amount: entry.amount,
          serving: entry.serving,
          serving_quantity: entry.serving_quantity,
        },
      ],
    }),
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
  });
var removeUserConsumedItem = async (token, entry) =>
  fetchYazio('/user/consumed-items', {
    method: 'DELETE',
    body: JSON.stringify([entry]),
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
  });

// upstream/src/api/user/bodyvalues/weight.ts
var import_zod6 = require('zod');
var GetUserWeightOptionsSchema = import_zod6.z.object({
  date: import_zod6.z
    .union([import_zod6.z.date(), import_zod6.z.string()])
    .optional(),
});
var UserWeightSchema = import_zod6.z.object({
  id: import_zod6.z.string().uuid(),
  date: import_zod6.z.string(),
  value: import_zod6.z.number().nullable(),
  external_id: import_zod6.z.string().nullable(),
  gateway: import_zod6.z.string().nullable(),
  source: import_zod6.z.string().nullable(),
});
var getUserWeight = async (token, options) =>
  fetchYazio(
    `/user/bodyvalues/weight/last?date=${parseDate(
      options?.date ?? /* @__PURE__ */ new Date(),
    )}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
  );

// upstream/src/api/user/products/suggested.ts
var import_zod7 = require('zod');
var GetUserSuggestedProductsOptionsSchema = import_zod7.z.object({
  date: import_zod7.z
    .union([import_zod7.z.date(), import_zod7.z.string()])
    .optional(),
  daytime: DaytimeSchema,
});
var UserSuggestedProductSchema = import_zod7.z.object({
  product_id: import_zod7.z.string().uuid(),
  amount: import_zod7.z.number().positive(),
  serving: import_zod7.z.string().nullable(),
  serving_quantity: import_zod7.z.number().nullable(),
});
var getUserSuggestedProducts = async (token, options) =>
  fetchYazio(
    `/user/products/suggested?date=${parseDate(
      options.date ?? /* @__PURE__ */ new Date(),
    )}&daytime=${options.daytime}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
  );

// upstream/src/api/user/diet.ts
var import_zod8 = require('zod');
var UserDietaryPreferencesSchema = import_zod8.z.object({
  restriction: import_zod8.z.string().nullable(),
});
var getUserDietaryPreferences = async (token) =>
  fetchYazio(`/user/dietary-preferences`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

// upstream/src/api/user/exercises.ts
var import_zod9 = require('zod');
var GetUserExercisesOptionsSchema = import_zod9.z.object({
  date: import_zod9.z
    .union([import_zod9.z.date(), import_zod9.z.string()])
    .optional(),
});
var ExerciseSchema = import_zod9.z.object({
  id: import_zod9.z.string().uuid(),
  note: import_zod9.z.string().nullable(),
  date: import_zod9.z.string(),
  name: import_zod9.z.string(),
  external_id: import_zod9.z.string().nullable(),
  energy: import_zod9.z.number(),
  distance: import_zod9.z.number(),
  duration: import_zod9.z.number(),
  source: import_zod9.z.string().nullable(),
  gateway: import_zod9.z.string().nullable(),
  steps: import_zod9.z.number(),
});
var getUserExercises = async (token, options) =>
  fetchYazio(
    `/user/exercises?date=${parseDate(options?.date ?? /* @__PURE__ */ new Date())}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
  );

// upstream/src/api/user/goals.ts
var import_zod10 = require('zod');
var GetUserGoalsOptionsSchema = import_zod10.z.object({
  date: import_zod10.z
    .union([import_zod10.z.date(), import_zod10.z.string()])
    .optional(),
});
var UserGoalsSchema = import_zod10.z.object({
  'energy.energy': import_zod10.z.number(),
  'nutrient.protein': import_zod10.z.number(),
  'nutrient.fat': import_zod10.z.number(),
  'nutrient.carb': import_zod10.z.number(),
  'activity.step': import_zod10.z.number(),
  'bodyvalue.weight': import_zod10.z.number(),
  water: import_zod10.z.number(),
});
var getUserGoals = async (token, options) =>
  fetchYazio(
    `/user/goals/unmodified?date=${parseDate(options?.date ?? /* @__PURE__ */ new Date())}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
  );

// upstream/src/api/user/settings.ts
var import_zod11 = require('zod');
var UserSettingsSchema = import_zod11.z.object({
  has_water_tracker: import_zod11.z.boolean(),
  has_diary_tipps: import_zod11.z.boolean(),
  has_meal_reminders: import_zod11.z.boolean(),
  has_usage_reminders: import_zod11.z.boolean(),
  has_weight_reminders: import_zod11.z.boolean(),
  has_water_reminders: import_zod11.z.boolean(),
  consume_activity_calories: import_zod11.z.boolean(),
  has_feelings: import_zod11.z.boolean(),
  has_fasting_tracker_reminders: import_zod11.z.boolean(),
  has_fasting_stage_reminders: import_zod11.z.boolean(),
});
var getUserSettings = async (token) =>
  fetchYazio(`/user/settings`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

// upstream/src/api/user/summary.ts
var import_zod12 = require('zod');
var GetUserDailySummaryOptions = import_zod12.z.object({
  date: import_zod12.z
    .union([import_zod12.z.date(), import_zod12.z.string()])
    .optional(),
});
var MealSchema = import_zod12.z.object({
  energy_goal: import_zod12.z.number(),
  nutrients: BasicNutrientsSchema,
});
var MealsSchema = import_zod12.z.object({
  breakfast: MealSchema,
  lunch: MealSchema,
  dinner: MealSchema,
  snack: MealSchema,
});
var GoalsSchema = import_zod12.z.object({
  'energy.energy': import_zod12.z.number(),
  water: import_zod12.z.number(),
  'activity.step': import_zod12.z.number(),
  'nutrient.protein': import_zod12.z.number(),
  'nutrient.fat': import_zod12.z.number(),
  'nutrient.carb': import_zod12.z.number(),
  'bodyvalue.weight': import_zod12.z.number(),
});
var UnitsSchema = import_zod12.z.object({
  unit_mass: import_zod12.z.string(),
  unit_energy: import_zod12.z.string(),
  unit_serving: import_zod12.z.string(),
  unit_length: import_zod12.z.string(),
});
var UserSchema = import_zod12.z.object({
  start_weight: import_zod12.z.number().optional(),
  current_weight: import_zod12.z.number().optional(),
  goal: import_zod12.z.string().optional(),
  sex: import_zod12.z.string().optional(),
});
var UserDailySummarySchema = import_zod12.z.object({
  activity_energy: import_zod12.z.number(),
  consume_activity_energy: import_zod12.z.boolean(),
  steps: import_zod12.z.number(),
  water_intake: import_zod12.z.number(),
  goals: GoalsSchema,
  units: UnitsSchema,
  meals: MealsSchema,
  user: UserSchema,
  active_fasting_countdown_template_key: import_zod12.z.string().nullable(),
});
var getUserDailySummary = async (token, options) =>
  fetchYazio(
    `/user/widgets/daily-summary?date=${parseDate(
      options?.date ?? /* @__PURE__ */ new Date(),
    )}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
  );

// upstream/src/api/user/water.ts
var import_zod13 = require('zod');
var GetUserWaterIntakeOptionsSchema = import_zod13.z.object({
  date: import_zod13.z
    .union([import_zod13.z.date(), import_zod13.z.string()])
    .optional(),
});
var UserWaterIntakeSchema = import_zod13.z.object({
  water_intake: import_zod13.z.number(),
  gateway: import_zod13.z.string().nullable(),
  source: import_zod13.z.string().nullable(),
});
var getUserWaterIntake = async (token, options) =>
  fetchYazio(
    `/user/water-intake?date=${parseDate(options?.date ?? /* @__PURE__ */ new Date())}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    },
  );

// upstream/src/api/user/recipes.ts
var import_zod14 = require('zod');
var RecipeServingSchema = import_zod14.z.object({
  producer: import_zod14.z.string().nullable(),
  name: import_zod14.z.string(),
  amount: import_zod14.z.number(),
  base_unit: import_zod14.z.string(),
  serving: import_zod14.z.string().nullable(),
  serving_quantity: import_zod14.z.number().nullable(),
  note: import_zod14.z.string().nullable(),
  product_id: import_zod14.z.string().uuid(),
});
var RecipeSchema = import_zod14.z.object({
  id: import_zod14.z.string().uuid(),
  yazio_id: import_zod14.z.string().nullable(),
  locale: import_zod14.z.string(),
  name: import_zod14.z.string(),
  portion_count: import_zod14.z.number(),
  nutrients: import_zod14.z.record(
    import_zod14.z.string(),
    import_zod14.z.number(),
  ),
  image: import_zod14.z.string().nullable(),
  instructions: import_zod14.z.array(import_zod14.z.string()),
  is_yazio_recipe: import_zod14.z.boolean(),
  available_since: import_zod14.z.string().nullable(),
  is_pro_recipe: import_zod14.z.boolean(),
  servings: import_zod14.z.array(RecipeServingSchema),
});
var getUserRecipeIds = async (token) =>
  fetchYazio(`/user/recipes`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/json',
    },
  });
var getRecipe = async (token, recipeId) =>
  fetchYazio(`/recipes/${recipeId}`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/json',
    },
  });
var deleteUserRecipe = async (token, recipeId) =>
  fetchYazio(`/user/recipes/${recipeId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

// upstream/src/api/user/index.ts
var import_zod15 = require('zod');
var UserSchema2 = import_zod15.z.object({
  diet: import_zod15.z
    .object({
      carb_percentage: import_zod15.z.number(),
      fat_percentage: import_zod15.z.number(),
      protein_percentage: import_zod15.z.number(),
      name: import_zod15.z.string(),
    })
    .nullable(),
  email: import_zod15.z.string().email(),
  premium_type: import_zod15.z.string(),
  sex: import_zod15.z.enum(['male', 'female', 'other']),
  first_name: import_zod15.z.string(),
  last_name: import_zod15.z.string(),
  city: import_zod15.z.string(),
  country: import_zod15.z.string().length(2),
  weight_change_per_week: import_zod15.z.number(),
  body_height: import_zod15.z.number(),
  goal: import_zod15.z.string(),
  date_of_birth: import_zod15.z.string(),
  registration_date: import_zod15.z.string(),
  timezone_offset: import_zod15.z.number(),
  unit_length: import_zod15.z.string(),
  unit_mass: import_zod15.z.string(),
  unit_glucose: import_zod15.z.string(),
  unit_serving: import_zod15.z.string(),
  unit_energy: import_zod15.z.string(),
  food_database_country: import_zod15.z.string().length(2),
  profile_image: import_zod15.z.string().url(),
  user_token: import_zod15.z.string(),
  start_weight: import_zod15.z.number(),
  email_confirmation_status: import_zod15.z.enum(['confirmed', 'unconfirmed']),
  newsletter_opt_in: import_zod15.z.boolean(),
  login_type: import_zod15.z.string(),
  siwa_user_id: import_zod15.z.string().nullable(),
  uuid: import_zod15.z.string().uuid(),
  reset_date: import_zod15.z.string().nullable(),
  activity_degree: import_zod15.z.string(),
  stripe_customer_id: import_zod15.z.string().nullable(),
});
var getUser = async (token) =>
  fetchYazio('/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

// upstream/src/api/user/meal-images.ts
var import_zod16 = require('zod');
var GetUserMealImagesOptionsSchema = import_zod16.z.object({
  date: import_zod16.z
    .union([import_zod16.z.date(), import_zod16.z.string()])
    .optional(),
});
var UserMealImagesSchema = import_zod16.z.record(
  DaytimeSchema,
  import_zod16.z.string().url(),
);
var getUserMealImages = async (token, options) => {
  const data = await fetchYazio(
    `/user/meal-images/${parseDate(options?.date ?? /* @__PURE__ */ new Date())}`,
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  return UserMealImagesSchema.parse(data);
};

// upstream/src/index.ts
var Products = class {
  auth;
  constructor(auth) {
    this.auth = auth;
  }
  get = async (id) => getProduct(await this.auth.authenticate(), id);
  search = async (options) =>
    searchProducts(await this.auth.authenticate(), options);
};
var User = class {
  auth;
  constructor(auth) {
    this.auth = auth;
  }
  get = async () => getUser(await this.auth.authenticate());
  getWeight = async (options) =>
    getUserWeight(await this.auth.authenticate(), options);
  getSuggestedProducts = async (options) =>
    getUserSuggestedProducts(await this.auth.authenticate(), options);
  getDietaryPreferences = async () =>
    getUserDietaryPreferences(await this.auth.authenticate());
  getExercises = async (options) =>
    getUserExercises(await this.auth.authenticate(), options);
  getGoals = async (options) =>
    getUserGoals(await this.auth.authenticate(), options);
  getSettings = async () => getUserSettings(await this.auth.authenticate());
  getWaterIntake = async (options) =>
    getUserWaterIntake(await this.auth.authenticate(), options);
  getDailySummary = async (options) =>
    getUserDailySummary(await this.auth.authenticate(), options);
  getConsumedItems = async (options) =>
    getUserConsumedItems(await this.auth.authenticate(), options);
  getMealImages = async (options) =>
    getUserMealImages(await this.auth.authenticate(), options);
  addConsumedItem = async (options) =>
    addUserConsumedItem(await this.auth.authenticate(), options);
  removeConsumedItem = async (options) =>
    removeUserConsumedItem(await this.auth.authenticate(), options);
  getRecipe = async (id) => getRecipe(await this.auth.authenticate(), id);
  getRecipeIds = async () => getUserRecipeIds(await this.auth.authenticate());
  deleteRecipe = async (id) =>
    deleteUserRecipe(await this.auth.authenticate(), id);
};
var Yazio = class {
  auth;
  products;
  user;
  /**
   * Create a new YAZIO API client.
   *
   * @param auth - The authentication details. Either in the form of an object
   * containing a previously obtained token pair or account credentials, or an
   * instance of `YazioAuth`.
   */
  constructor(auth) {
    this.auth = auth instanceof YazioAuth ? auth : new YazioAuth(auth);
    this.products = new Products(this.auth);
    this.user = new User(this.auth);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 &&
  (module.exports = {
    GetUserMealImagesOptionsSchema,
    UserMealImagesSchema,
    Yazio,
    YazioAuth,
    addUserConsumedItem,
    deleteUserRecipe,
    fetchYazio,
    getProduct,
    getRecipe,
    getTokenFromCredentials,
    getTokenFromRefreshToken,
    getUser,
    getUserConsumedItems,
    getUserDailySummary,
    getUserDietaryPreferences,
    getUserExercises,
    getUserGoals,
    getUserMealImages,
    getUserRecipeIds,
    getUserSettings,
    getUserSuggestedProducts,
    getUserWaterIntake,
    getUserWeight,
    removeUserConsumedItem,
    searchProducts,
  });
