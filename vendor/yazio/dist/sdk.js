/* eslint-disable */

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
import { z } from 'zod';
var TokenSchema = z.object({
  token_type: z.string(),
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  expires_at: z.number(),
});
var TokenResolverSchema = z.union([
  TokenSchema,
  z
    .function()
    .returns(
      z.union([
        TokenSchema,
        z.promise(z.union([TokenSchema, z.null()])),
        z.null(),
      ]),
    ),
]);
var CredentialsSchema = z.object({
  username: z.string(),
  password: z.string(),
});
var CredentialsResolverSchema = z.union([
  CredentialsSchema,
  z.promise(CredentialsSchema),
  z
    .function()
    .returns(
      z.union([
        CredentialsSchema,
        z.promise(z.union([CredentialsSchema, z.null()])),
        z.null(),
      ]),
    ),
  z.promise(CredentialsSchema),
]);
var RefreshHandlerSchema = z
  .function()
  .args(z.object({ token: TokenSchema }))
  .returns(z.any());
var YazioAuthInitSchema = z.union([
  z.object({
    credentials: CredentialsResolverSchema,
    token: z.undefined(),
    onRefresh: RefreshHandlerSchema.optional(),
  }),
  z.object({
    credentials: z.undefined(),
    token: TokenResolverSchema,
    onRefresh: RefreshHandlerSchema.optional(),
  }),
  z.object({
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
import { z as z2 } from 'zod';
var NutrientsSchema = z2.object({
  'energy.energy': z2.number(),
  'mineral.calcium': z2.number(),
  'mineral.chlorine': z2.number(),
  'mineral.copper': z2.number(),
  'mineral.fluorine': z2.number(),
  'mineral.iron': z2.number(),
  'mineral.magnesium': z2.number(),
  'mineral.manganese': z2.number(),
  'mineral.phosphorus': z2.number(),
  'mineral.potassium': z2.number(),
  'mineral.sulfur': z2.number(),
  'mineral.zinc': z2.number(),
  'nutrient.carb': z2.number(),
  'nutrient.dietaryfiber': z2.number(),
  'nutrient.fat': z2.number(),
  'nutrient.protein': z2.number(),
  'nutrient.sugar': z2.number(),
  'vitamin.a': z2.number(),
  'vitamin.b1': z2.number(),
  'vitamin.b12': z2.number(),
  'vitamin.b2': z2.number(),
  'vitamin.b6': z2.number(),
  'vitamin.d': z2.number(),
  'vitamin.e': z2.number(),
});
var ServingSchema = z2.object({
  serving: z2.string(),
  amount: z2.number().positive(),
});
var ProductSchema = z2.object({
  id: z2.string().uuid(),
  name: z2.string(),
  is_verified: z2.boolean(),
  is_private: z2.boolean(),
  is_deleted: z2.boolean(),
  has_ean: z2.boolean(),
  category: z2.string(),
  producer: z2.string().nullable(),
  nutrients: NutrientsSchema,
  updated_at: z2.string(),
  servings: z2.array(ServingSchema),
  base_unit: z2.string(),
  eans: z2.array(z2.string()),
  language: z2.string(),
  countries: z2.array(z2.string()),
});
var getProduct = async (token, id) =>
  fetchYazio(`/products/${id}`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  }).then((product) => (product ? { ...product, id } : null));

// upstream/src/api/products/search.ts
import { z as z3 } from 'zod';
var SearchProductOptionsSchema = z3.object({
  query: z3.string(),
  sex: z3.union([z3.literal('male'), z3.literal('female')]).optional(),
  countries: z3.array(z3.string().length(2)).optional(),
  locales: z3.array(z3.string().length(5)).optional(),
});
var BasicNutrientsSchema = z3.object({
  'energy.energy': z3.number(),
  'nutrient.carb': z3.number(),
  'nutrient.protein': z3.number(),
  'nutrient.fat': z3.number(),
});
var ProductSearchResultSchema = z3.object({
  score: z3.number(),
  name: z3.string(),
  product_id: z3.string().uuid(),
  serving: z3.string(),
  serving_quantity: z3.number().positive(),
  amount: z3.number().positive(),
  base_unit: z3.string(),
  producer: z3.string(),
  is_verified: z3.boolean(),
  nutrients: BasicNutrientsSchema,
  countries: z3.array(z3.string()),
  language: z3.string(),
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
import { z as z4 } from 'zod';
var DaytimeSchema = z4.enum(['breakfast', 'lunch', 'dinner', 'snack']);

// upstream/src/utils/date.ts
var parseDate = (input) => {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toISOString().split('T')[0];
};

// upstream/src/api/user/consumed.ts
import { z as z5 } from 'zod';
var GetUserConsumedItemsOptionsSchema = z5.object({
  date: z5.union([z5.date(), z5.string()]).optional(),
});
var UserConsumedItemSchema = z5.object({
  id: z5.string().uuid(),
  date: z5.string(),
  daytime: DaytimeSchema,
  type: z5.string(),
  product_id: z5.string().uuid(),
  amount: z5.number().positive(),
  serving: z5.string().nullable(),
  serving_quantity: z5.number().nullable(),
});
var RecipePortionConsumedItemSchema = z5.object({
  id: z5.string().uuid(),
  date: z5.string(),
  daytime: DaytimeSchema,
  type: z5.literal('recipe_portion'),
  recipe_id: z5.string().uuid(),
  portion_count: z5.number(),
});
var SimpleProductConsumedItemSchema = z5.object({
  id: z5.string().uuid(),
  date: z5.string(),
  daytime: DaytimeSchema,
  type: z5.literal('simple_product'),
  name: z5.string(),
  nutrients: z5.record(z5.string(), z5.number()),
  is_ai_generated: z5.boolean(),
});
var GetUserConsumedItemsResponseSchema = z5.object({
  products: z5.array(UserConsumedItemSchema),
  recipe_portions: z5.array(RecipePortionConsumedItemSchema),
  simple_products: z5.array(SimpleProductConsumedItemSchema),
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
var AddUserConsumedItemsOptionsSchema = z5.union([
  z5.object({
    id: z5.string().uuid(),
    product_id: z5.string().uuid(),
    date: z5.union([z5.date(), z5.string()]),
    daytime: DaytimeSchema,
    amount: z5.number(),
    serving: z5.string(),
    serving_quantity: z5.number(),
  }),
  z5.object({
    id: z5.string().uuid(),
    product_id: z5.string().uuid(),
    date: z5.union([z5.date(), z5.string()]),
    daytime: DaytimeSchema,
    amount: z5.number(),
    serving: z5.null(),
    serving_quantity: z5.null(),
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
import { z as z6 } from 'zod';
var GetUserWeightOptionsSchema = z6.object({
  date: z6.union([z6.date(), z6.string()]).optional(),
});
var UserWeightSchema = z6.object({
  id: z6.string().uuid(),
  date: z6.string(),
  value: z6.number().nullable(),
  external_id: z6.string().nullable(),
  gateway: z6.string().nullable(),
  source: z6.string().nullable(),
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
import { z as z7 } from 'zod';
var GetUserSuggestedProductsOptionsSchema = z7.object({
  date: z7.union([z7.date(), z7.string()]).optional(),
  daytime: DaytimeSchema,
});
var UserSuggestedProductSchema = z7.object({
  product_id: z7.string().uuid(),
  amount: z7.number().positive(),
  serving: z7.string().nullable(),
  serving_quantity: z7.number().nullable(),
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
import { z as z8 } from 'zod';
var UserDietaryPreferencesSchema = z8.object({
  restriction: z8.string().nullable(),
});
var getUserDietaryPreferences = async (token) =>
  fetchYazio(`/user/dietary-preferences`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

// upstream/src/api/user/exercises.ts
import { z as z9 } from 'zod';
var GetUserExercisesOptionsSchema = z9.object({
  date: z9.union([z9.date(), z9.string()]).optional(),
});
var ExerciseSchema = z9.object({
  id: z9.string().uuid(),
  note: z9.string().nullable(),
  date: z9.string(),
  name: z9.string(),
  external_id: z9.string().nullable(),
  energy: z9.number(),
  distance: z9.number(),
  duration: z9.number(),
  source: z9.string().nullable(),
  gateway: z9.string().nullable(),
  steps: z9.number(),
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
import { z as z10 } from 'zod';
var GetUserGoalsOptionsSchema = z10.object({
  date: z10.union([z10.date(), z10.string()]).optional(),
});
var UserGoalsSchema = z10.object({
  'energy.energy': z10.number(),
  'nutrient.protein': z10.number(),
  'nutrient.fat': z10.number(),
  'nutrient.carb': z10.number(),
  'activity.step': z10.number(),
  'bodyvalue.weight': z10.number(),
  water: z10.number(),
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
import { z as z11 } from 'zod';
var UserSettingsSchema = z11.object({
  has_water_tracker: z11.boolean(),
  has_diary_tipps: z11.boolean(),
  has_meal_reminders: z11.boolean(),
  has_usage_reminders: z11.boolean(),
  has_weight_reminders: z11.boolean(),
  has_water_reminders: z11.boolean(),
  consume_activity_calories: z11.boolean(),
  has_feelings: z11.boolean(),
  has_fasting_tracker_reminders: z11.boolean(),
  has_fasting_stage_reminders: z11.boolean(),
});
var getUserSettings = async (token) =>
  fetchYazio(`/user/settings`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

// upstream/src/api/user/summary.ts
import { z as z12 } from 'zod';
var GetUserDailySummaryOptions = z12.object({
  date: z12.union([z12.date(), z12.string()]).optional(),
});
var MealSchema = z12.object({
  energy_goal: z12.number(),
  nutrients: BasicNutrientsSchema,
});
var MealsSchema = z12.object({
  breakfast: MealSchema,
  lunch: MealSchema,
  dinner: MealSchema,
  snack: MealSchema,
});
var GoalsSchema = z12.object({
  'energy.energy': z12.number(),
  water: z12.number(),
  'activity.step': z12.number(),
  'nutrient.protein': z12.number(),
  'nutrient.fat': z12.number(),
  'nutrient.carb': z12.number(),
  'bodyvalue.weight': z12.number(),
});
var UnitsSchema = z12.object({
  unit_mass: z12.string(),
  unit_energy: z12.string(),
  unit_serving: z12.string(),
  unit_length: z12.string(),
});
var UserSchema = z12.object({
  start_weight: z12.number().optional(),
  current_weight: z12.number().optional(),
  goal: z12.string().optional(),
  sex: z12.string().optional(),
});
var UserDailySummarySchema = z12.object({
  activity_energy: z12.number(),
  consume_activity_energy: z12.boolean(),
  steps: z12.number(),
  water_intake: z12.number(),
  goals: GoalsSchema,
  units: UnitsSchema,
  meals: MealsSchema,
  user: UserSchema,
  active_fasting_countdown_template_key: z12.string().nullable(),
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
import { z as z13 } from 'zod';
var GetUserWaterIntakeOptionsSchema = z13.object({
  date: z13.union([z13.date(), z13.string()]).optional(),
});
var UserWaterIntakeSchema = z13.object({
  water_intake: z13.number(),
  gateway: z13.string().nullable(),
  source: z13.string().nullable(),
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
import { z as z14 } from 'zod';
var RecipeServingSchema = z14.object({
  producer: z14.string().nullable(),
  name: z14.string(),
  amount: z14.number(),
  base_unit: z14.string(),
  serving: z14.string().nullable(),
  serving_quantity: z14.number().nullable(),
  note: z14.string().nullable(),
  product_id: z14.string().uuid(),
});
var RecipeSchema = z14.object({
  id: z14.string().uuid(),
  yazio_id: z14.string().nullable(),
  locale: z14.string(),
  name: z14.string(),
  portion_count: z14.number(),
  nutrients: z14.record(z14.string(), z14.number()),
  image: z14.string().nullable(),
  instructions: z14.array(z14.string()),
  is_yazio_recipe: z14.boolean(),
  available_since: z14.string().nullable(),
  is_pro_recipe: z14.boolean(),
  servings: z14.array(RecipeServingSchema),
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
import { z as z15 } from 'zod';
var UserSchema2 = z15.object({
  diet: z15
    .object({
      carb_percentage: z15.number(),
      fat_percentage: z15.number(),
      protein_percentage: z15.number(),
      name: z15.string(),
    })
    .nullable(),
  email: z15.string().email(),
  premium_type: z15.string(),
  sex: z15.enum(['male', 'female', 'other']),
  first_name: z15.string(),
  last_name: z15.string(),
  city: z15.string(),
  country: z15.string().length(2),
  weight_change_per_week: z15.number(),
  body_height: z15.number(),
  goal: z15.string(),
  date_of_birth: z15.string(),
  registration_date: z15.string(),
  timezone_offset: z15.number(),
  unit_length: z15.string(),
  unit_mass: z15.string(),
  unit_glucose: z15.string(),
  unit_serving: z15.string(),
  unit_energy: z15.string(),
  food_database_country: z15.string().length(2),
  profile_image: z15.string().url(),
  user_token: z15.string(),
  start_weight: z15.number(),
  email_confirmation_status: z15.enum(['confirmed', 'unconfirmed']),
  newsletter_opt_in: z15.boolean(),
  login_type: z15.string(),
  siwa_user_id: z15.string().nullable(),
  uuid: z15.string().uuid(),
  reset_date: z15.string().nullable(),
  activity_degree: z15.string(),
  stripe_customer_id: z15.string().nullable(),
});
var getUser = async (token) =>
  fetchYazio('/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });

// upstream/src/api/user/meal-images.ts
import { z as z16 } from 'zod';
var GetUserMealImagesOptionsSchema = z16.object({
  date: z16.union([z16.date(), z16.string()]).optional(),
});
var UserMealImagesSchema = z16.record(DaytimeSchema, z16.string().url());
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
export {
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
};
