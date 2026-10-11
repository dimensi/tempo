/* eslint-disable */
import { z } from 'zod';

declare const TokenSchema: z.ZodObject<
  {
    token_type: z.ZodString;
    access_token: z.ZodString;
    refresh_token: z.ZodString;
    expires_in: z.ZodNumber;
    expires_at: z.ZodNumber;
  },
  'strip',
  z.ZodTypeAny,
  {
    token_type: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at: number;
  },
  {
    token_type: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at: number;
  }
>;
type Token = z.infer<typeof TokenSchema>;
declare const TokenResolverSchema: z.ZodUnion<
  [
    z.ZodObject<
      {
        token_type: z.ZodString;
        access_token: z.ZodString;
        refresh_token: z.ZodString;
        expires_in: z.ZodNumber;
        expires_at: z.ZodNumber;
      },
      'strip',
      z.ZodTypeAny,
      {
        token_type: string;
        access_token: string;
        refresh_token: string;
        expires_in: number;
        expires_at: number;
      },
      {
        token_type: string;
        access_token: string;
        refresh_token: string;
        expires_in: number;
        expires_at: number;
      }
    >,
    z.ZodFunction<
      z.ZodTuple<[], z.ZodUnknown>,
      z.ZodUnion<
        [
          z.ZodObject<
            {
              token_type: z.ZodString;
              access_token: z.ZodString;
              refresh_token: z.ZodString;
              expires_in: z.ZodNumber;
              expires_at: z.ZodNumber;
            },
            'strip',
            z.ZodTypeAny,
            {
              token_type: string;
              access_token: string;
              refresh_token: string;
              expires_in: number;
              expires_at: number;
            },
            {
              token_type: string;
              access_token: string;
              refresh_token: string;
              expires_in: number;
              expires_at: number;
            }
          >,
          z.ZodPromise<
            z.ZodUnion<
              [
                z.ZodObject<
                  {
                    token_type: z.ZodString;
                    access_token: z.ZodString;
                    refresh_token: z.ZodString;
                    expires_in: z.ZodNumber;
                    expires_at: z.ZodNumber;
                  },
                  'strip',
                  z.ZodTypeAny,
                  {
                    token_type: string;
                    access_token: string;
                    refresh_token: string;
                    expires_in: number;
                    expires_at: number;
                  },
                  {
                    token_type: string;
                    access_token: string;
                    refresh_token: string;
                    expires_in: number;
                    expires_at: number;
                  }
                >,
                z.ZodNull,
              ]
            >
          >,
          z.ZodNull,
        ]
      >
    >,
  ]
>;
type TokenResolver = z.infer<typeof TokenResolverSchema>;
declare const CredentialsSchema: z.ZodObject<
  {
    username: z.ZodString;
    password: z.ZodString;
  },
  'strip',
  z.ZodTypeAny,
  {
    username: string;
    password: string;
  },
  {
    username: string;
    password: string;
  }
>;
type Credentials = z.infer<typeof CredentialsSchema>;
declare const CredentialsResolverSchema: z.ZodUnion<
  [
    z.ZodObject<
      {
        username: z.ZodString;
        password: z.ZodString;
      },
      'strip',
      z.ZodTypeAny,
      {
        username: string;
        password: string;
      },
      {
        username: string;
        password: string;
      }
    >,
    z.ZodPromise<
      z.ZodObject<
        {
          username: z.ZodString;
          password: z.ZodString;
        },
        'strip',
        z.ZodTypeAny,
        {
          username: string;
          password: string;
        },
        {
          username: string;
          password: string;
        }
      >
    >,
    z.ZodFunction<
      z.ZodTuple<[], z.ZodUnknown>,
      z.ZodUnion<
        [
          z.ZodObject<
            {
              username: z.ZodString;
              password: z.ZodString;
            },
            'strip',
            z.ZodTypeAny,
            {
              username: string;
              password: string;
            },
            {
              username: string;
              password: string;
            }
          >,
          z.ZodPromise<
            z.ZodUnion<
              [
                z.ZodObject<
                  {
                    username: z.ZodString;
                    password: z.ZodString;
                  },
                  'strip',
                  z.ZodTypeAny,
                  {
                    username: string;
                    password: string;
                  },
                  {
                    username: string;
                    password: string;
                  }
                >,
                z.ZodNull,
              ]
            >
          >,
          z.ZodNull,
        ]
      >
    >,
    z.ZodPromise<
      z.ZodObject<
        {
          username: z.ZodString;
          password: z.ZodString;
        },
        'strip',
        z.ZodTypeAny,
        {
          username: string;
          password: string;
        },
        {
          username: string;
          password: string;
        }
      >
    >,
  ]
>;
type CredentialsResolver = z.infer<typeof CredentialsResolverSchema>;
declare const RefreshHandlerSchema: z.ZodFunction<
  z.ZodTuple<
    [
      z.ZodObject<
        {
          token: z.ZodObject<
            {
              token_type: z.ZodString;
              access_token: z.ZodString;
              refresh_token: z.ZodString;
              expires_in: z.ZodNumber;
              expires_at: z.ZodNumber;
            },
            'strip',
            z.ZodTypeAny,
            {
              token_type: string;
              access_token: string;
              refresh_token: string;
              expires_in: number;
              expires_at: number;
            },
            {
              token_type: string;
              access_token: string;
              refresh_token: string;
              expires_in: number;
              expires_at: number;
            }
          >;
        },
        'strip',
        z.ZodTypeAny,
        {
          token: {
            token_type: string;
            access_token: string;
            refresh_token: string;
            expires_in: number;
            expires_at: number;
          };
        },
        {
          token: {
            token_type: string;
            access_token: string;
            refresh_token: string;
            expires_in: number;
            expires_at: number;
          };
        }
      >,
    ],
    z.ZodUnknown
  >,
  z.ZodAny
>;
type RefreshHandler = z.infer<typeof RefreshHandlerSchema>;
declare const YazioAuthInitSchema: z.ZodUnion<
  [
    z.ZodObject<
      {
        credentials: z.ZodUnion<
          [
            z.ZodObject<
              {
                username: z.ZodString;
                password: z.ZodString;
              },
              'strip',
              z.ZodTypeAny,
              {
                username: string;
                password: string;
              },
              {
                username: string;
                password: string;
              }
            >,
            z.ZodPromise<
              z.ZodObject<
                {
                  username: z.ZodString;
                  password: z.ZodString;
                },
                'strip',
                z.ZodTypeAny,
                {
                  username: string;
                  password: string;
                },
                {
                  username: string;
                  password: string;
                }
              >
            >,
            z.ZodFunction<
              z.ZodTuple<[], z.ZodUnknown>,
              z.ZodUnion<
                [
                  z.ZodObject<
                    {
                      username: z.ZodString;
                      password: z.ZodString;
                    },
                    'strip',
                    z.ZodTypeAny,
                    {
                      username: string;
                      password: string;
                    },
                    {
                      username: string;
                      password: string;
                    }
                  >,
                  z.ZodPromise<
                    z.ZodUnion<
                      [
                        z.ZodObject<
                          {
                            username: z.ZodString;
                            password: z.ZodString;
                          },
                          'strip',
                          z.ZodTypeAny,
                          {
                            username: string;
                            password: string;
                          },
                          {
                            username: string;
                            password: string;
                          }
                        >,
                        z.ZodNull,
                      ]
                    >
                  >,
                  z.ZodNull,
                ]
              >
            >,
            z.ZodPromise<
              z.ZodObject<
                {
                  username: z.ZodString;
                  password: z.ZodString;
                },
                'strip',
                z.ZodTypeAny,
                {
                  username: string;
                  password: string;
                },
                {
                  username: string;
                  password: string;
                }
              >
            >,
          ]
        >;
        token: z.ZodUndefined;
        onRefresh: z.ZodOptional<
          z.ZodFunction<
            z.ZodTuple<
              [
                z.ZodObject<
                  {
                    token: z.ZodObject<
                      {
                        token_type: z.ZodString;
                        access_token: z.ZodString;
                        refresh_token: z.ZodString;
                        expires_in: z.ZodNumber;
                        expires_at: z.ZodNumber;
                      },
                      'strip',
                      z.ZodTypeAny,
                      {
                        token_type: string;
                        access_token: string;
                        refresh_token: string;
                        expires_in: number;
                        expires_at: number;
                      },
                      {
                        token_type: string;
                        access_token: string;
                        refresh_token: string;
                        expires_in: number;
                        expires_at: number;
                      }
                    >;
                  },
                  'strip',
                  z.ZodTypeAny,
                  {
                    token: {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    };
                  },
                  {
                    token: {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    };
                  }
                >,
              ],
              z.ZodUnknown
            >,
            z.ZodAny
          >
        >;
      },
      'strip',
      z.ZodTypeAny,
      {
        credentials:
          | {
              username: string;
              password: string;
            }
          | Promise<{
              username: string;
              password: string;
            }>
          | ((...args: unknown[]) =>
              | {
                  username: string;
                  password: string;
                }
              | Promise<{
                  username: string;
                  password: string;
                } | null>
              | null);
        token?: undefined;
        onRefresh?:
          | ((
              args_0: {
                token: {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                };
              },
              ...args: unknown[]
            ) => any)
          | undefined;
      },
      {
        credentials:
          | {
              username: string;
              password: string;
            }
          | Promise<{
              username: string;
              password: string;
            }>
          | ((...args: unknown[]) =>
              | {
                  username: string;
                  password: string;
                }
              | Promise<{
                  username: string;
                  password: string;
                } | null>
              | null);
        token?: undefined;
        onRefresh?:
          | ((
              args_0: {
                token: {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                };
              },
              ...args: unknown[]
            ) => any)
          | undefined;
      }
    >,
    z.ZodObject<
      {
        credentials: z.ZodUndefined;
        token: z.ZodUnion<
          [
            z.ZodObject<
              {
                token_type: z.ZodString;
                access_token: z.ZodString;
                refresh_token: z.ZodString;
                expires_in: z.ZodNumber;
                expires_at: z.ZodNumber;
              },
              'strip',
              z.ZodTypeAny,
              {
                token_type: string;
                access_token: string;
                refresh_token: string;
                expires_in: number;
                expires_at: number;
              },
              {
                token_type: string;
                access_token: string;
                refresh_token: string;
                expires_in: number;
                expires_at: number;
              }
            >,
            z.ZodFunction<
              z.ZodTuple<[], z.ZodUnknown>,
              z.ZodUnion<
                [
                  z.ZodObject<
                    {
                      token_type: z.ZodString;
                      access_token: z.ZodString;
                      refresh_token: z.ZodString;
                      expires_in: z.ZodNumber;
                      expires_at: z.ZodNumber;
                    },
                    'strip',
                    z.ZodTypeAny,
                    {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    },
                    {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    }
                  >,
                  z.ZodPromise<
                    z.ZodUnion<
                      [
                        z.ZodObject<
                          {
                            token_type: z.ZodString;
                            access_token: z.ZodString;
                            refresh_token: z.ZodString;
                            expires_in: z.ZodNumber;
                            expires_at: z.ZodNumber;
                          },
                          'strip',
                          z.ZodTypeAny,
                          {
                            token_type: string;
                            access_token: string;
                            refresh_token: string;
                            expires_in: number;
                            expires_at: number;
                          },
                          {
                            token_type: string;
                            access_token: string;
                            refresh_token: string;
                            expires_in: number;
                            expires_at: number;
                          }
                        >,
                        z.ZodNull,
                      ]
                    >
                  >,
                  z.ZodNull,
                ]
              >
            >,
          ]
        >;
        onRefresh: z.ZodOptional<
          z.ZodFunction<
            z.ZodTuple<
              [
                z.ZodObject<
                  {
                    token: z.ZodObject<
                      {
                        token_type: z.ZodString;
                        access_token: z.ZodString;
                        refresh_token: z.ZodString;
                        expires_in: z.ZodNumber;
                        expires_at: z.ZodNumber;
                      },
                      'strip',
                      z.ZodTypeAny,
                      {
                        token_type: string;
                        access_token: string;
                        refresh_token: string;
                        expires_in: number;
                        expires_at: number;
                      },
                      {
                        token_type: string;
                        access_token: string;
                        refresh_token: string;
                        expires_in: number;
                        expires_at: number;
                      }
                    >;
                  },
                  'strip',
                  z.ZodTypeAny,
                  {
                    token: {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    };
                  },
                  {
                    token: {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    };
                  }
                >,
              ],
              z.ZodUnknown
            >,
            z.ZodAny
          >
        >;
      },
      'strip',
      z.ZodTypeAny,
      {
        token:
          | {
              token_type: string;
              access_token: string;
              refresh_token: string;
              expires_in: number;
              expires_at: number;
            }
          | ((...args: unknown[]) =>
              | {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                }
              | Promise<{
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                } | null>
              | null);
        credentials?: undefined;
        onRefresh?:
          | ((
              args_0: {
                token: {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                };
              },
              ...args: unknown[]
            ) => any)
          | undefined;
      },
      {
        token:
          | {
              token_type: string;
              access_token: string;
              refresh_token: string;
              expires_in: number;
              expires_at: number;
            }
          | ((...args: unknown[]) =>
              | {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                }
              | Promise<{
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                } | null>
              | null);
        credentials?: undefined;
        onRefresh?:
          | ((
              args_0: {
                token: {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                };
              },
              ...args: unknown[]
            ) => any)
          | undefined;
      }
    >,
    z.ZodObject<
      {
        credentials: z.ZodUnion<
          [
            z.ZodObject<
              {
                username: z.ZodString;
                password: z.ZodString;
              },
              'strip',
              z.ZodTypeAny,
              {
                username: string;
                password: string;
              },
              {
                username: string;
                password: string;
              }
            >,
            z.ZodPromise<
              z.ZodObject<
                {
                  username: z.ZodString;
                  password: z.ZodString;
                },
                'strip',
                z.ZodTypeAny,
                {
                  username: string;
                  password: string;
                },
                {
                  username: string;
                  password: string;
                }
              >
            >,
            z.ZodFunction<
              z.ZodTuple<[], z.ZodUnknown>,
              z.ZodUnion<
                [
                  z.ZodObject<
                    {
                      username: z.ZodString;
                      password: z.ZodString;
                    },
                    'strip',
                    z.ZodTypeAny,
                    {
                      username: string;
                      password: string;
                    },
                    {
                      username: string;
                      password: string;
                    }
                  >,
                  z.ZodPromise<
                    z.ZodUnion<
                      [
                        z.ZodObject<
                          {
                            username: z.ZodString;
                            password: z.ZodString;
                          },
                          'strip',
                          z.ZodTypeAny,
                          {
                            username: string;
                            password: string;
                          },
                          {
                            username: string;
                            password: string;
                          }
                        >,
                        z.ZodNull,
                      ]
                    >
                  >,
                  z.ZodNull,
                ]
              >
            >,
            z.ZodPromise<
              z.ZodObject<
                {
                  username: z.ZodString;
                  password: z.ZodString;
                },
                'strip',
                z.ZodTypeAny,
                {
                  username: string;
                  password: string;
                },
                {
                  username: string;
                  password: string;
                }
              >
            >,
          ]
        >;
        token: z.ZodUnion<
          [
            z.ZodObject<
              {
                token_type: z.ZodString;
                access_token: z.ZodString;
                refresh_token: z.ZodString;
                expires_in: z.ZodNumber;
                expires_at: z.ZodNumber;
              },
              'strip',
              z.ZodTypeAny,
              {
                token_type: string;
                access_token: string;
                refresh_token: string;
                expires_in: number;
                expires_at: number;
              },
              {
                token_type: string;
                access_token: string;
                refresh_token: string;
                expires_in: number;
                expires_at: number;
              }
            >,
            z.ZodFunction<
              z.ZodTuple<[], z.ZodUnknown>,
              z.ZodUnion<
                [
                  z.ZodObject<
                    {
                      token_type: z.ZodString;
                      access_token: z.ZodString;
                      refresh_token: z.ZodString;
                      expires_in: z.ZodNumber;
                      expires_at: z.ZodNumber;
                    },
                    'strip',
                    z.ZodTypeAny,
                    {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    },
                    {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    }
                  >,
                  z.ZodPromise<
                    z.ZodUnion<
                      [
                        z.ZodObject<
                          {
                            token_type: z.ZodString;
                            access_token: z.ZodString;
                            refresh_token: z.ZodString;
                            expires_in: z.ZodNumber;
                            expires_at: z.ZodNumber;
                          },
                          'strip',
                          z.ZodTypeAny,
                          {
                            token_type: string;
                            access_token: string;
                            refresh_token: string;
                            expires_in: number;
                            expires_at: number;
                          },
                          {
                            token_type: string;
                            access_token: string;
                            refresh_token: string;
                            expires_in: number;
                            expires_at: number;
                          }
                        >,
                        z.ZodNull,
                      ]
                    >
                  >,
                  z.ZodNull,
                ]
              >
            >,
          ]
        >;
        onRefresh: z.ZodOptional<
          z.ZodFunction<
            z.ZodTuple<
              [
                z.ZodObject<
                  {
                    token: z.ZodObject<
                      {
                        token_type: z.ZodString;
                        access_token: z.ZodString;
                        refresh_token: z.ZodString;
                        expires_in: z.ZodNumber;
                        expires_at: z.ZodNumber;
                      },
                      'strip',
                      z.ZodTypeAny,
                      {
                        token_type: string;
                        access_token: string;
                        refresh_token: string;
                        expires_in: number;
                        expires_at: number;
                      },
                      {
                        token_type: string;
                        access_token: string;
                        refresh_token: string;
                        expires_in: number;
                        expires_at: number;
                      }
                    >;
                  },
                  'strip',
                  z.ZodTypeAny,
                  {
                    token: {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    };
                  },
                  {
                    token: {
                      token_type: string;
                      access_token: string;
                      refresh_token: string;
                      expires_in: number;
                      expires_at: number;
                    };
                  }
                >,
              ],
              z.ZodUnknown
            >,
            z.ZodAny
          >
        >;
      },
      'strip',
      z.ZodTypeAny,
      {
        token:
          | {
              token_type: string;
              access_token: string;
              refresh_token: string;
              expires_in: number;
              expires_at: number;
            }
          | ((...args: unknown[]) =>
              | {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                }
              | Promise<{
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                } | null>
              | null);
        credentials:
          | {
              username: string;
              password: string;
            }
          | Promise<{
              username: string;
              password: string;
            }>
          | ((...args: unknown[]) =>
              | {
                  username: string;
                  password: string;
                }
              | Promise<{
                  username: string;
                  password: string;
                } | null>
              | null);
        onRefresh?:
          | ((
              args_0: {
                token: {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                };
              },
              ...args: unknown[]
            ) => any)
          | undefined;
      },
      {
        token:
          | {
              token_type: string;
              access_token: string;
              refresh_token: string;
              expires_in: number;
              expires_at: number;
            }
          | ((...args: unknown[]) =>
              | {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                }
              | Promise<{
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                } | null>
              | null);
        credentials:
          | {
              username: string;
              password: string;
            }
          | Promise<{
              username: string;
              password: string;
            }>
          | ((...args: unknown[]) =>
              | {
                  username: string;
                  password: string;
                }
              | Promise<{
                  username: string;
                  password: string;
                } | null>
              | null);
        onRefresh?:
          | ((
              args_0: {
                token: {
                  token_type: string;
                  access_token: string;
                  refresh_token: string;
                  expires_in: number;
                  expires_at: number;
                };
              },
              ...args: unknown[]
            ) => any)
          | undefined;
      }
    >,
  ]
>;
type YazioAuthInit = z.infer<typeof YazioAuthInitSchema>;

declare const GetUserExercisesOptionsSchema: z.ZodObject<
  {
    date: z.ZodOptional<z.ZodUnion<[z.ZodDate, z.ZodString]>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    date?: string | Date | undefined;
  },
  {
    date?: string | Date | undefined;
  }
>;
type GetUserExercisesOptions = z.infer<typeof GetUserExercisesOptionsSchema>;
declare const ExerciseSchema: z.ZodObject<
  {
    id: z.ZodString;
    note: z.ZodNullable<z.ZodString>;
    date: z.ZodString;
    name: z.ZodString;
    external_id: z.ZodNullable<z.ZodString>;
    energy: z.ZodNumber;
    distance: z.ZodNumber;
    duration: z.ZodNumber;
    source: z.ZodNullable<z.ZodString>;
    gateway: z.ZodNullable<z.ZodString>;
    steps: z.ZodNumber;
  },
  'strip',
  z.ZodTypeAny,
  {
    date: string;
    id: string;
    name: string;
    external_id: string | null;
    gateway: string | null;
    source: string | null;
    note: string | null;
    energy: number;
    distance: number;
    duration: number;
    steps: number;
  },
  {
    date: string;
    id: string;
    name: string;
    external_id: string | null;
    gateway: string | null;
    source: string | null;
    note: string | null;
    energy: number;
    distance: number;
    duration: number;
    steps: number;
  }
>;
type Exercise = z.infer<typeof ExerciseSchema>;
/**
 * Get the exercises done by the user, optionally for a specific day.
 *
 * @param token - The token to use for authentication.
 * @param options - Optional options to customize the request.
 *
 * @returns - Promise resolving to the user exercises.
 */
declare const getUserExercises: (
  token: Token,
  options?: GetUserExercisesOptions,
) => Promise<{
  training: Array<Exercise>;
  custom_training: Array<Exercise>;
}>;

declare class YazioAuth {
  private token;
  private credentials;
  private cachedToken;
  private onRefresh;
  /**
   * Get a valid token pair for the current session.
   *
   * @returns - Promise resolving to a Token object containing the key pairs.
   */
  authenticate: () => Promise<Token>;
  constructor(init: YazioAuthInit);
}

/**
 * Get either a fresh token pair or one that has previously been stored in
 * memory from a previous request run.
 *
 * @param credentials - Credentials object containing the username and password.
 *
 * @returns - Promise resolving to a Token object containing the key pairs. This
 * is retrieved either from memory or from the API.
 */
declare const getTokenFromCredentials: (
  credentials: Credentials,
) => Promise<Token>;
/**
 * Refresh an access token using a refresh token.
 * Uses the same /oauth/token endpoint with grant_type: "refresh_token".
 *
 * @param refreshToken - The refresh_token from a previous auth response.
 *
 * @returns - Promise resolving to a new Token (access_token, refresh_token, expires_in).
 */
declare const getTokenFromRefreshToken: (
  refreshToken: string,
) => Promise<Token>;

declare const ProductSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    is_verified: z.ZodBoolean;
    is_private: z.ZodBoolean;
    is_deleted: z.ZodBoolean;
    has_ean: z.ZodBoolean;
    category: z.ZodString;
    producer: z.ZodNullable<z.ZodString>;
    nutrients: z.ZodObject<
      {
        'energy.energy': z.ZodNumber;
        'mineral.calcium': z.ZodNumber;
        'mineral.chlorine': z.ZodNumber;
        'mineral.copper': z.ZodNumber;
        'mineral.fluorine': z.ZodNumber;
        'mineral.iron': z.ZodNumber;
        'mineral.magnesium': z.ZodNumber;
        'mineral.manganese': z.ZodNumber;
        'mineral.phosphorus': z.ZodNumber;
        'mineral.potassium': z.ZodNumber;
        'mineral.sulfur': z.ZodNumber;
        'mineral.zinc': z.ZodNumber;
        'nutrient.carb': z.ZodNumber;
        'nutrient.dietaryfiber': z.ZodNumber;
        'nutrient.fat': z.ZodNumber;
        'nutrient.protein': z.ZodNumber;
        'nutrient.sugar': z.ZodNumber;
        'vitamin.a': z.ZodNumber;
        'vitamin.b1': z.ZodNumber;
        'vitamin.b12': z.ZodNumber;
        'vitamin.b2': z.ZodNumber;
        'vitamin.b6': z.ZodNumber;
        'vitamin.d': z.ZodNumber;
        'vitamin.e': z.ZodNumber;
      },
      'strip',
      z.ZodTypeAny,
      {
        'energy.energy': number;
        'mineral.calcium': number;
        'mineral.chlorine': number;
        'mineral.copper': number;
        'mineral.fluorine': number;
        'mineral.iron': number;
        'mineral.magnesium': number;
        'mineral.manganese': number;
        'mineral.phosphorus': number;
        'mineral.potassium': number;
        'mineral.sulfur': number;
        'mineral.zinc': number;
        'nutrient.carb': number;
        'nutrient.dietaryfiber': number;
        'nutrient.fat': number;
        'nutrient.protein': number;
        'nutrient.sugar': number;
        'vitamin.a': number;
        'vitamin.b1': number;
        'vitamin.b12': number;
        'vitamin.b2': number;
        'vitamin.b6': number;
        'vitamin.d': number;
        'vitamin.e': number;
      },
      {
        'energy.energy': number;
        'mineral.calcium': number;
        'mineral.chlorine': number;
        'mineral.copper': number;
        'mineral.fluorine': number;
        'mineral.iron': number;
        'mineral.magnesium': number;
        'mineral.manganese': number;
        'mineral.phosphorus': number;
        'mineral.potassium': number;
        'mineral.sulfur': number;
        'mineral.zinc': number;
        'nutrient.carb': number;
        'nutrient.dietaryfiber': number;
        'nutrient.fat': number;
        'nutrient.protein': number;
        'nutrient.sugar': number;
        'vitamin.a': number;
        'vitamin.b1': number;
        'vitamin.b12': number;
        'vitamin.b2': number;
        'vitamin.b6': number;
        'vitamin.d': number;
        'vitamin.e': number;
      }
    >;
    updated_at: z.ZodString;
    servings: z.ZodArray<
      z.ZodObject<
        {
          serving: z.ZodString;
          amount: z.ZodNumber;
        },
        'strip',
        z.ZodTypeAny,
        {
          serving: string;
          amount: number;
        },
        {
          serving: string;
          amount: number;
        }
      >,
      'many'
    >;
    base_unit: z.ZodString;
    eans: z.ZodArray<z.ZodString, 'many'>;
    language: z.ZodString;
    countries: z.ZodArray<z.ZodString, 'many'>;
  },
  'strip',
  z.ZodTypeAny,
  {
    id: string;
    name: string;
    is_verified: boolean;
    is_private: boolean;
    is_deleted: boolean;
    has_ean: boolean;
    category: string;
    producer: string | null;
    nutrients: {
      'energy.energy': number;
      'mineral.calcium': number;
      'mineral.chlorine': number;
      'mineral.copper': number;
      'mineral.fluorine': number;
      'mineral.iron': number;
      'mineral.magnesium': number;
      'mineral.manganese': number;
      'mineral.phosphorus': number;
      'mineral.potassium': number;
      'mineral.sulfur': number;
      'mineral.zinc': number;
      'nutrient.carb': number;
      'nutrient.dietaryfiber': number;
      'nutrient.fat': number;
      'nutrient.protein': number;
      'nutrient.sugar': number;
      'vitamin.a': number;
      'vitamin.b1': number;
      'vitamin.b12': number;
      'vitamin.b2': number;
      'vitamin.b6': number;
      'vitamin.d': number;
      'vitamin.e': number;
    };
    updated_at: string;
    servings: {
      serving: string;
      amount: number;
    }[];
    base_unit: string;
    eans: string[];
    language: string;
    countries: string[];
  },
  {
    id: string;
    name: string;
    is_verified: boolean;
    is_private: boolean;
    is_deleted: boolean;
    has_ean: boolean;
    category: string;
    producer: string | null;
    nutrients: {
      'energy.energy': number;
      'mineral.calcium': number;
      'mineral.chlorine': number;
      'mineral.copper': number;
      'mineral.fluorine': number;
      'mineral.iron': number;
      'mineral.magnesium': number;
      'mineral.manganese': number;
      'mineral.phosphorus': number;
      'mineral.potassium': number;
      'mineral.sulfur': number;
      'mineral.zinc': number;
      'nutrient.carb': number;
      'nutrient.dietaryfiber': number;
      'nutrient.fat': number;
      'nutrient.protein': number;
      'nutrient.sugar': number;
      'vitamin.a': number;
      'vitamin.b1': number;
      'vitamin.b12': number;
      'vitamin.b2': number;
      'vitamin.b6': number;
      'vitamin.d': number;
      'vitamin.e': number;
    };
    updated_at: string;
    servings: {
      serving: string;
      amount: number;
    }[];
    base_unit: string;
    eans: string[];
    language: string;
    countries: string[];
  }
>;
type Product = z.infer<typeof ProductSchema>;
/**
 * Get the details of a specific product.
 *
 * @param token - The token to use for authentication.
 * @param id - The ID of the product to get.
 *
 * @returns - Promise resolving to the product details or `null`.
 */
declare const getProduct: (token: Token, id: string) => Promise<Product | null>;

declare const SearchProductOptionsSchema: z.ZodObject<
  {
    query: z.ZodString;
    sex: z.ZodOptional<
      z.ZodUnion<[z.ZodLiteral<'male'>, z.ZodLiteral<'female'>]>
    >;
    countries: z.ZodOptional<z.ZodArray<z.ZodString, 'many'>>;
    locales: z.ZodOptional<z.ZodArray<z.ZodString, 'many'>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    query: string;
    countries?: string[] | undefined;
    sex?: 'male' | 'female' | undefined;
    locales?: string[] | undefined;
  },
  {
    query: string;
    countries?: string[] | undefined;
    sex?: 'male' | 'female' | undefined;
    locales?: string[] | undefined;
  }
>;
type SearchProductOptions = z.infer<typeof SearchProductOptionsSchema>;
declare const ProductSearchResultSchema: z.ZodObject<
  {
    score: z.ZodNumber;
    name: z.ZodString;
    product_id: z.ZodString;
    serving: z.ZodString;
    serving_quantity: z.ZodNumber;
    amount: z.ZodNumber;
    base_unit: z.ZodString;
    producer: z.ZodString;
    is_verified: z.ZodBoolean;
    nutrients: z.ZodObject<
      {
        'energy.energy': z.ZodNumber;
        'nutrient.carb': z.ZodNumber;
        'nutrient.protein': z.ZodNumber;
        'nutrient.fat': z.ZodNumber;
      },
      'strip',
      z.ZodTypeAny,
      {
        'energy.energy': number;
        'nutrient.carb': number;
        'nutrient.fat': number;
        'nutrient.protein': number;
      },
      {
        'energy.energy': number;
        'nutrient.carb': number;
        'nutrient.fat': number;
        'nutrient.protein': number;
      }
    >;
    countries: z.ZodArray<z.ZodString, 'many'>;
    language: z.ZodString;
  },
  'strip',
  z.ZodTypeAny,
  {
    serving: string;
    amount: number;
    name: string;
    is_verified: boolean;
    producer: string;
    nutrients: {
      'energy.energy': number;
      'nutrient.carb': number;
      'nutrient.fat': number;
      'nutrient.protein': number;
    };
    base_unit: string;
    language: string;
    countries: string[];
    score: number;
    product_id: string;
    serving_quantity: number;
  },
  {
    serving: string;
    amount: number;
    name: string;
    is_verified: boolean;
    producer: string;
    nutrients: {
      'energy.energy': number;
      'nutrient.carb': number;
      'nutrient.fat': number;
      'nutrient.protein': number;
    };
    base_unit: string;
    language: string;
    countries: string[];
    score: number;
    product_id: string;
    serving_quantity: number;
  }
>;
type ProductSearchResult = z.infer<typeof ProductSearchResultSchema>;
/**
 * Search for products by a query.
 *
 * @param token - The token to use for authentication.
 * @param options - Options to customize the search.
 *
 * @returns - Promise resolving to the search results.
 */
declare const searchProducts: (
  token: Token,
  options: SearchProductOptions,
) => Promise<Array<ProductSearchResult>>;

declare const GetUserConsumedItemsOptionsSchema: z.ZodObject<
  {
    date: z.ZodOptional<z.ZodUnion<[z.ZodDate, z.ZodString]>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    date?: string | Date | undefined;
  },
  {
    date?: string | Date | undefined;
  }
>;
type GetUserConsumedItemsOptions = z.infer<
  typeof GetUserConsumedItemsOptionsSchema
>;
declare const GetUserConsumedItemsResponseSchema: z.ZodObject<
  {
    products: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          date: z.ZodString;
          daytime: z.ZodEnum<['breakfast', 'lunch', 'dinner', 'snack']>;
          type: z.ZodString;
          product_id: z.ZodString;
          amount: z.ZodNumber;
          serving: z.ZodNullable<z.ZodString>;
          serving_quantity: z.ZodNullable<z.ZodNumber>;
        },
        'strip',
        z.ZodTypeAny,
        {
          type: string;
          date: string;
          serving: string | null;
          amount: number;
          id: string;
          product_id: string;
          serving_quantity: number | null;
          daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
        },
        {
          type: string;
          date: string;
          serving: string | null;
          amount: number;
          id: string;
          product_id: string;
          serving_quantity: number | null;
          daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
        }
      >,
      'many'
    >;
    recipe_portions: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          date: z.ZodString;
          daytime: z.ZodEnum<['breakfast', 'lunch', 'dinner', 'snack']>;
          type: z.ZodLiteral<'recipe_portion'>;
          recipe_id: z.ZodString;
          portion_count: z.ZodNumber;
        },
        'strip',
        z.ZodTypeAny,
        {
          type: 'recipe_portion';
          date: string;
          id: string;
          daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
          recipe_id: string;
          portion_count: number;
        },
        {
          type: 'recipe_portion';
          date: string;
          id: string;
          daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
          recipe_id: string;
          portion_count: number;
        }
      >,
      'many'
    >;
    simple_products: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          date: z.ZodString;
          daytime: z.ZodEnum<['breakfast', 'lunch', 'dinner', 'snack']>;
          type: z.ZodLiteral<'simple_product'>;
          name: z.ZodString;
          nutrients: z.ZodRecord<z.ZodString, z.ZodNumber>;
          is_ai_generated: z.ZodBoolean;
        },
        'strip',
        z.ZodTypeAny,
        {
          type: 'simple_product';
          date: string;
          id: string;
          name: string;
          nutrients: Record<string, number>;
          daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
          is_ai_generated: boolean;
        },
        {
          type: 'simple_product';
          date: string;
          id: string;
          name: string;
          nutrients: Record<string, number>;
          daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
          is_ai_generated: boolean;
        }
      >,
      'many'
    >;
  },
  'strip',
  z.ZodTypeAny,
  {
    products: {
      type: string;
      date: string;
      serving: string | null;
      amount: number;
      id: string;
      product_id: string;
      serving_quantity: number | null;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    }[];
    recipe_portions: {
      type: 'recipe_portion';
      date: string;
      id: string;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      recipe_id: string;
      portion_count: number;
    }[];
    simple_products: {
      type: 'simple_product';
      date: string;
      id: string;
      name: string;
      nutrients: Record<string, number>;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      is_ai_generated: boolean;
    }[];
  },
  {
    products: {
      type: string;
      date: string;
      serving: string | null;
      amount: number;
      id: string;
      product_id: string;
      serving_quantity: number | null;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    }[];
    recipe_portions: {
      type: 'recipe_portion';
      date: string;
      id: string;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      recipe_id: string;
      portion_count: number;
    }[];
    simple_products: {
      type: 'simple_product';
      date: string;
      id: string;
      name: string;
      nutrients: Record<string, number>;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      is_ai_generated: boolean;
    }[];
  }
>;
type GetUserConsumedItemsResponse = z.infer<
  typeof GetUserConsumedItemsResponseSchema
>;
/**
 * Get the consumed items of the user, optionally for a specific day.
 *
 * @param token - The token to use for authentication.
 * @param options - Optional options to customize the request.
 *
 * @returns - Promise resolving to the user consumed items.
 */
declare const getUserConsumedItems: (
  token: Token,
  options?: GetUserConsumedItemsOptions,
) => Promise<GetUserConsumedItemsResponse>;
declare const AddUserConsumedItemsOptionsSchema: z.ZodUnion<
  [
    z.ZodObject<
      {
        id: z.ZodString;
        product_id: z.ZodString;
        date: z.ZodUnion<[z.ZodDate, z.ZodString]>;
        daytime: z.ZodEnum<['breakfast', 'lunch', 'dinner', 'snack']>;
        amount: z.ZodNumber;
        serving: z.ZodString;
        serving_quantity: z.ZodNumber;
      },
      'strip',
      z.ZodTypeAny,
      {
        date: string | Date;
        serving: string;
        amount: number;
        id: string;
        product_id: string;
        serving_quantity: number;
        daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      },
      {
        date: string | Date;
        serving: string;
        amount: number;
        id: string;
        product_id: string;
        serving_quantity: number;
        daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      }
    >,
    z.ZodObject<
      {
        id: z.ZodString;
        product_id: z.ZodString;
        date: z.ZodUnion<[z.ZodDate, z.ZodString]>;
        daytime: z.ZodEnum<['breakfast', 'lunch', 'dinner', 'snack']>;
        amount: z.ZodNumber;
        serving: z.ZodNull;
        serving_quantity: z.ZodNull;
      },
      'strip',
      z.ZodTypeAny,
      {
        date: string | Date;
        serving: null;
        amount: number;
        id: string;
        product_id: string;
        serving_quantity: null;
        daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      },
      {
        date: string | Date;
        serving: null;
        amount: number;
        id: string;
        product_id: string;
        serving_quantity: null;
        daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      }
    >,
  ]
>;
type AddUserConsumedItemsOptions = z.infer<
  typeof AddUserConsumedItemsOptionsSchema
>;
/**
 * Add a consumed item to the users diary.
 *
 * @param token - The token to use for authentication.
 * @param entry - Details about the product to add.
 *
 * @returns - Promise resolving when the item was added successfully.
 */
declare const addUserConsumedItem: (
  token: Token,
  entry: AddUserConsumedItemsOptions,
) => Promise<void>;
/**
 * Remove a consumed item from the users diary.
 *
 * @param token - The token to use for authentication.
 * @param entry - The ID of the consumed item to remove.
 *
 * **Warning:** The `entry` parameter is the ID of the consumed item, not the
 * ID of the product.
 *
 * @returns - Promise resolving when the item was removed successfully.
 */
declare const removeUserConsumedItem: (
  token: Token,
  entry: AddUserConsumedItemsOptions['id'],
) => Promise<void>;

declare const GetUserWeightOptionsSchema: z.ZodObject<
  {
    date: z.ZodOptional<z.ZodUnion<[z.ZodDate, z.ZodString]>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    date?: string | Date | undefined;
  },
  {
    date?: string | Date | undefined;
  }
>;
type GetUserWeightOptions = z.infer<typeof GetUserWeightOptionsSchema>;
declare const UserWeightSchema: z.ZodObject<
  {
    id: z.ZodString;
    date: z.ZodString;
    value: z.ZodNullable<z.ZodNumber>;
    external_id: z.ZodNullable<z.ZodString>;
    gateway: z.ZodNullable<z.ZodString>;
    source: z.ZodNullable<z.ZodString>;
  },
  'strip',
  z.ZodTypeAny,
  {
    value: number | null;
    date: string;
    id: string;
    external_id: string | null;
    gateway: string | null;
    source: string | null;
  },
  {
    value: number | null;
    date: string;
    id: string;
    external_id: string | null;
    gateway: string | null;
    source: string | null;
  }
>;
type UserWeight = z.infer<typeof UserWeightSchema>;
/**
 * Get the last weight entry of the user, optionally for a specific day.
 *
 * @param token - The token to use for authentication.
 * @param options - Optional options to customize the request.
 *
 * @returns - Promise resolving the latest weight entry of the user.
 */
declare const getUserWeight: (
  token: Token,
  options?: GetUserWeightOptions,
) => Promise<UserWeight | null>;

declare const GetUserSuggestedProductsOptionsSchema: z.ZodObject<
  {
    date: z.ZodOptional<z.ZodUnion<[z.ZodDate, z.ZodString]>>;
    daytime: z.ZodEnum<['breakfast', 'lunch', 'dinner', 'snack']>;
  },
  'strip',
  z.ZodTypeAny,
  {
    daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    date?: string | Date | undefined;
  },
  {
    daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    date?: string | Date | undefined;
  }
>;
type GetUserSuggestedProductsOptions = z.infer<
  typeof GetUserSuggestedProductsOptionsSchema
>;
declare const UserSuggestedProductSchema: z.ZodObject<
  {
    product_id: z.ZodString;
    amount: z.ZodNumber;
    serving: z.ZodNullable<z.ZodString>;
    serving_quantity: z.ZodNullable<z.ZodNumber>;
  },
  'strip',
  z.ZodTypeAny,
  {
    serving: string | null;
    amount: number;
    product_id: string;
    serving_quantity: number | null;
  },
  {
    serving: string | null;
    amount: number;
    product_id: string;
    serving_quantity: number | null;
  }
>;
type UserSuggestedProduct = z.infer<typeof UserSuggestedProductSchema>;
/**
 * Get the suggested products for a user for a specific daytime, optionally
 * for a specific day.
 *
 * @param token - Token to use for authentication.
 * @param options - Options for the request.
 */
declare const getUserSuggestedProducts: (
  token: Token,
  options: GetUserSuggestedProductsOptions,
) => Promise<Array<UserSuggestedProduct>>;

declare const UserDietaryPreferencesSchema: z.ZodObject<
  {
    restriction: z.ZodNullable<z.ZodString>;
  },
  'strip',
  z.ZodTypeAny,
  {
    restriction: string | null;
  },
  {
    restriction: string | null;
  }
>;
type UserDietaryPreferences = z.infer<typeof UserDietaryPreferencesSchema>;
/**
 * Get the dietary preferences of the user.
 *
 * @param token - The token to use for authentication.
 *
 * @returns - Promise resolving to the user dietary preferences.
 */
declare const getUserDietaryPreferences: (
  token: Token,
) => Promise<UserDietaryPreferences>;

declare const GetUserGoalsOptionsSchema: z.ZodObject<
  {
    date: z.ZodOptional<z.ZodUnion<[z.ZodDate, z.ZodString]>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    date?: string | Date | undefined;
  },
  {
    date?: string | Date | undefined;
  }
>;
type GetUserGoalsOptions = z.infer<typeof GetUserGoalsOptionsSchema>;
declare const UserGoalsSchema: z.ZodObject<
  {
    'energy.energy': z.ZodNumber;
    'nutrient.protein': z.ZodNumber;
    'nutrient.fat': z.ZodNumber;
    'nutrient.carb': z.ZodNumber;
    'activity.step': z.ZodNumber;
    'bodyvalue.weight': z.ZodNumber;
    water: z.ZodNumber;
  },
  'strip',
  z.ZodTypeAny,
  {
    'energy.energy': number;
    'nutrient.carb': number;
    'nutrient.fat': number;
    'nutrient.protein': number;
    'activity.step': number;
    'bodyvalue.weight': number;
    water: number;
  },
  {
    'energy.energy': number;
    'nutrient.carb': number;
    'nutrient.fat': number;
    'nutrient.protein': number;
    'activity.step': number;
    'bodyvalue.weight': number;
    water: number;
  }
>;
type UserGoals = z.infer<typeof UserGoalsSchema>;
/**
 * Get the goals of the user, optionally for a specific day.
 *
 * @param token - The token to use for authentication.
 * @param options - Optional options to customize the request.
 *
 * @returns - Promise resolving to the user goals.
 */
declare const getUserGoals: (
  token: Token,
  options?: GetUserGoalsOptions,
) => Promise<UserGoals>;

declare const UserSettingsSchema: z.ZodObject<
  {
    has_water_tracker: z.ZodBoolean;
    has_diary_tipps: z.ZodBoolean;
    has_meal_reminders: z.ZodBoolean;
    has_usage_reminders: z.ZodBoolean;
    has_weight_reminders: z.ZodBoolean;
    has_water_reminders: z.ZodBoolean;
    consume_activity_calories: z.ZodBoolean;
    has_feelings: z.ZodBoolean;
    has_fasting_tracker_reminders: z.ZodBoolean;
    has_fasting_stage_reminders: z.ZodBoolean;
  },
  'strip',
  z.ZodTypeAny,
  {
    has_water_tracker: boolean;
    has_diary_tipps: boolean;
    has_meal_reminders: boolean;
    has_usage_reminders: boolean;
    has_weight_reminders: boolean;
    has_water_reminders: boolean;
    consume_activity_calories: boolean;
    has_feelings: boolean;
    has_fasting_tracker_reminders: boolean;
    has_fasting_stage_reminders: boolean;
  },
  {
    has_water_tracker: boolean;
    has_diary_tipps: boolean;
    has_meal_reminders: boolean;
    has_usage_reminders: boolean;
    has_weight_reminders: boolean;
    has_water_reminders: boolean;
    consume_activity_calories: boolean;
    has_feelings: boolean;
    has_fasting_tracker_reminders: boolean;
    has_fasting_stage_reminders: boolean;
  }
>;
type UserSettings = z.infer<typeof UserSettingsSchema>;
/**
 * Get the user settings.
 *
 * @param token - The token to use for authentication.
 *
 * @returns - Promise resolving to the user settings.
 */
declare const getUserSettings: (token: Token) => Promise<UserSettings>;

declare const GetUserDailySummaryOptions: z.ZodObject<
  {
    date: z.ZodOptional<z.ZodUnion<[z.ZodDate, z.ZodString]>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    date?: string | Date | undefined;
  },
  {
    date?: string | Date | undefined;
  }
>;
type GetUserDailySummaryOptions = z.infer<typeof GetUserDailySummaryOptions>;
declare const UserDailySummarySchema: z.ZodObject<
  {
    activity_energy: z.ZodNumber;
    consume_activity_energy: z.ZodBoolean;
    steps: z.ZodNumber;
    water_intake: z.ZodNumber;
    goals: z.ZodObject<
      {
        'energy.energy': z.ZodNumber;
        water: z.ZodNumber;
        'activity.step': z.ZodNumber;
        'nutrient.protein': z.ZodNumber;
        'nutrient.fat': z.ZodNumber;
        'nutrient.carb': z.ZodNumber;
        'bodyvalue.weight': z.ZodNumber;
      },
      'strip',
      z.ZodTypeAny,
      {
        'energy.energy': number;
        'nutrient.carb': number;
        'nutrient.fat': number;
        'nutrient.protein': number;
        'activity.step': number;
        'bodyvalue.weight': number;
        water: number;
      },
      {
        'energy.energy': number;
        'nutrient.carb': number;
        'nutrient.fat': number;
        'nutrient.protein': number;
        'activity.step': number;
        'bodyvalue.weight': number;
        water: number;
      }
    >;
    units: z.ZodObject<
      {
        unit_mass: z.ZodString;
        unit_energy: z.ZodString;
        unit_serving: z.ZodString;
        unit_length: z.ZodString;
      },
      'strip',
      z.ZodTypeAny,
      {
        unit_mass: string;
        unit_energy: string;
        unit_serving: string;
        unit_length: string;
      },
      {
        unit_mass: string;
        unit_energy: string;
        unit_serving: string;
        unit_length: string;
      }
    >;
    meals: z.ZodObject<
      {
        breakfast: z.ZodObject<
          {
            energy_goal: z.ZodNumber;
            nutrients: z.ZodObject<
              {
                'energy.energy': z.ZodNumber;
                'nutrient.carb': z.ZodNumber;
                'nutrient.protein': z.ZodNumber;
                'nutrient.fat': z.ZodNumber;
              },
              'strip',
              z.ZodTypeAny,
              {
                'energy.energy': number;
                'nutrient.carb': number;
                'nutrient.fat': number;
                'nutrient.protein': number;
              },
              {
                'energy.energy': number;
                'nutrient.carb': number;
                'nutrient.fat': number;
                'nutrient.protein': number;
              }
            >;
          },
          'strip',
          z.ZodTypeAny,
          {
            nutrients: {
              'energy.energy': number;
              'nutrient.carb': number;
              'nutrient.fat': number;
              'nutrient.protein': number;
            };
            energy_goal: number;
          },
          {
            nutrients: {
              'energy.energy': number;
              'nutrient.carb': number;
              'nutrient.fat': number;
              'nutrient.protein': number;
            };
            energy_goal: number;
          }
        >;
        lunch: z.ZodObject<
          {
            energy_goal: z.ZodNumber;
            nutrients: z.ZodObject<
              {
                'energy.energy': z.ZodNumber;
                'nutrient.carb': z.ZodNumber;
                'nutrient.protein': z.ZodNumber;
                'nutrient.fat': z.ZodNumber;
              },
              'strip',
              z.ZodTypeAny,
              {
                'energy.energy': number;
                'nutrient.carb': number;
                'nutrient.fat': number;
                'nutrient.protein': number;
              },
              {
                'energy.energy': number;
                'nutrient.carb': number;
                'nutrient.fat': number;
                'nutrient.protein': number;
              }
            >;
          },
          'strip',
          z.ZodTypeAny,
          {
            nutrients: {
              'energy.energy': number;
              'nutrient.carb': number;
              'nutrient.fat': number;
              'nutrient.protein': number;
            };
            energy_goal: number;
          },
          {
            nutrients: {
              'energy.energy': number;
              'nutrient.carb': number;
              'nutrient.fat': number;
              'nutrient.protein': number;
            };
            energy_goal: number;
          }
        >;
        dinner: z.ZodObject<
          {
            energy_goal: z.ZodNumber;
            nutrients: z.ZodObject<
              {
                'energy.energy': z.ZodNumber;
                'nutrient.carb': z.ZodNumber;
                'nutrient.protein': z.ZodNumber;
                'nutrient.fat': z.ZodNumber;
              },
              'strip',
              z.ZodTypeAny,
              {
                'energy.energy': number;
                'nutrient.carb': number;
                'nutrient.fat': number;
                'nutrient.protein': number;
              },
              {
                'energy.energy': number;
                'nutrient.carb': number;
                'nutrient.fat': number;
                'nutrient.protein': number;
              }
            >;
          },
          'strip',
          z.ZodTypeAny,
          {
            nutrients: {
              'energy.energy': number;
              'nutrient.carb': number;
              'nutrient.fat': number;
              'nutrient.protein': number;
            };
            energy_goal: number;
          },
          {
            nutrients: {
              'energy.energy': number;
              'nutrient.carb': number;
              'nutrient.fat': number;
              'nutrient.protein': number;
            };
            energy_goal: number;
          }
        >;
        snack: z.ZodObject<
          {
            energy_goal: z.ZodNumber;
            nutrients: z.ZodObject<
              {
                'energy.energy': z.ZodNumber;
                'nutrient.carb': z.ZodNumber;
                'nutrient.protein': z.ZodNumber;
                'nutrient.fat': z.ZodNumber;
              },
              'strip',
              z.ZodTypeAny,
              {
                'energy.energy': number;
                'nutrient.carb': number;
                'nutrient.fat': number;
                'nutrient.protein': number;
              },
              {
                'energy.energy': number;
                'nutrient.carb': number;
                'nutrient.fat': number;
                'nutrient.protein': number;
              }
            >;
          },
          'strip',
          z.ZodTypeAny,
          {
            nutrients: {
              'energy.energy': number;
              'nutrient.carb': number;
              'nutrient.fat': number;
              'nutrient.protein': number;
            };
            energy_goal: number;
          },
          {
            nutrients: {
              'energy.energy': number;
              'nutrient.carb': number;
              'nutrient.fat': number;
              'nutrient.protein': number;
            };
            energy_goal: number;
          }
        >;
      },
      'strip',
      z.ZodTypeAny,
      {
        breakfast: {
          nutrients: {
            'energy.energy': number;
            'nutrient.carb': number;
            'nutrient.fat': number;
            'nutrient.protein': number;
          };
          energy_goal: number;
        };
        lunch: {
          nutrients: {
            'energy.energy': number;
            'nutrient.carb': number;
            'nutrient.fat': number;
            'nutrient.protein': number;
          };
          energy_goal: number;
        };
        dinner: {
          nutrients: {
            'energy.energy': number;
            'nutrient.carb': number;
            'nutrient.fat': number;
            'nutrient.protein': number;
          };
          energy_goal: number;
        };
        snack: {
          nutrients: {
            'energy.energy': number;
            'nutrient.carb': number;
            'nutrient.fat': number;
            'nutrient.protein': number;
          };
          energy_goal: number;
        };
      },
      {
        breakfast: {
          nutrients: {
            'energy.energy': number;
            'nutrient.carb': number;
            'nutrient.fat': number;
            'nutrient.protein': number;
          };
          energy_goal: number;
        };
        lunch: {
          nutrients: {
            'energy.energy': number;
            'nutrient.carb': number;
            'nutrient.fat': number;
            'nutrient.protein': number;
          };
          energy_goal: number;
        };
        dinner: {
          nutrients: {
            'energy.energy': number;
            'nutrient.carb': number;
            'nutrient.fat': number;
            'nutrient.protein': number;
          };
          energy_goal: number;
        };
        snack: {
          nutrients: {
            'energy.energy': number;
            'nutrient.carb': number;
            'nutrient.fat': number;
            'nutrient.protein': number;
          };
          energy_goal: number;
        };
      }
    >;
    user: z.ZodObject<
      {
        start_weight: z.ZodOptional<z.ZodNumber>;
        current_weight: z.ZodOptional<z.ZodNumber>;
        goal: z.ZodOptional<z.ZodString>;
        sex: z.ZodOptional<z.ZodString>;
      },
      'strip',
      z.ZodTypeAny,
      {
        sex?: string | undefined;
        start_weight?: number | undefined;
        current_weight?: number | undefined;
        goal?: string | undefined;
      },
      {
        sex?: string | undefined;
        start_weight?: number | undefined;
        current_weight?: number | undefined;
        goal?: string | undefined;
      }
    >;
    active_fasting_countdown_template_key: z.ZodNullable<z.ZodString>;
  },
  'strip',
  z.ZodTypeAny,
  {
    steps: number;
    activity_energy: number;
    consume_activity_energy: boolean;
    water_intake: number;
    goals: {
      'energy.energy': number;
      'nutrient.carb': number;
      'nutrient.fat': number;
      'nutrient.protein': number;
      'activity.step': number;
      'bodyvalue.weight': number;
      water: number;
    };
    units: {
      unit_mass: string;
      unit_energy: string;
      unit_serving: string;
      unit_length: string;
    };
    meals: {
      breakfast: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      lunch: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      dinner: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      snack: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
    };
    user: {
      sex?: string | undefined;
      start_weight?: number | undefined;
      current_weight?: number | undefined;
      goal?: string | undefined;
    };
    active_fasting_countdown_template_key: string | null;
  },
  {
    steps: number;
    activity_energy: number;
    consume_activity_energy: boolean;
    water_intake: number;
    goals: {
      'energy.energy': number;
      'nutrient.carb': number;
      'nutrient.fat': number;
      'nutrient.protein': number;
      'activity.step': number;
      'bodyvalue.weight': number;
      water: number;
    };
    units: {
      unit_mass: string;
      unit_energy: string;
      unit_serving: string;
      unit_length: string;
    };
    meals: {
      breakfast: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      lunch: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      dinner: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      snack: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
    };
    user: {
      sex?: string | undefined;
      start_weight?: number | undefined;
      current_weight?: number | undefined;
      goal?: string | undefined;
    };
    active_fasting_countdown_template_key: string | null;
  }
>;
type UserDailySummary = z.infer<typeof UserDailySummarySchema>;
/**
 * Get the daily summary for a specific day.
 *
 * @param token - Token to use for authentication.
 * @param options - Options for the request.
 *
 * @returns - Promise resolving the daily summary.
 */
declare const getUserDailySummary: (
  token: Token,
  options?: GetUserDailySummaryOptions,
) => Promise<UserDailySummary>;

declare const GetUserWaterIntakeOptionsSchema: z.ZodObject<
  {
    date: z.ZodOptional<z.ZodUnion<[z.ZodDate, z.ZodString]>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    date?: string | Date | undefined;
  },
  {
    date?: string | Date | undefined;
  }
>;
type GetUserWaterIntakeOptions = z.infer<
  typeof GetUserWaterIntakeOptionsSchema
>;
declare const UserWaterIntakeSchema: z.ZodObject<
  {
    water_intake: z.ZodNumber;
    gateway: z.ZodNullable<z.ZodString>;
    source: z.ZodNullable<z.ZodString>;
  },
  'strip',
  z.ZodTypeAny,
  {
    gateway: string | null;
    source: string | null;
    water_intake: number;
  },
  {
    gateway: string | null;
    source: string | null;
    water_intake: number;
  }
>;
type UserWaterIntake = z.infer<typeof UserWaterIntakeSchema>;
/**
 * Get the water intake of the user, optionally for a specific day.
 *
 * @param token - The token to use for authentication.
 * @param options - Optional options to customize the request.
 *
 * @returns - Promise resolving to the user water intake.
 */
declare const getUserWaterIntake: (
  token: Token,
  options?: GetUserWaterIntakeOptions,
) => Promise<UserWaterIntake>;

declare const RecipeSchema: z.ZodObject<
  {
    id: z.ZodString;
    yazio_id: z.ZodNullable<z.ZodString>;
    locale: z.ZodString;
    name: z.ZodString;
    portion_count: z.ZodNumber;
    nutrients: z.ZodRecord<z.ZodString, z.ZodNumber>;
    image: z.ZodNullable<z.ZodString>;
    instructions: z.ZodArray<z.ZodString, 'many'>;
    is_yazio_recipe: z.ZodBoolean;
    available_since: z.ZodNullable<z.ZodString>;
    is_pro_recipe: z.ZodBoolean;
    servings: z.ZodArray<
      z.ZodObject<
        {
          producer: z.ZodNullable<z.ZodString>;
          name: z.ZodString;
          amount: z.ZodNumber;
          base_unit: z.ZodString;
          serving: z.ZodNullable<z.ZodString>;
          serving_quantity: z.ZodNullable<z.ZodNumber>;
          note: z.ZodNullable<z.ZodString>;
          product_id: z.ZodString;
        },
        'strip',
        z.ZodTypeAny,
        {
          serving: string | null;
          amount: number;
          name: string;
          producer: string | null;
          base_unit: string;
          product_id: string;
          serving_quantity: number | null;
          note: string | null;
        },
        {
          serving: string | null;
          amount: number;
          name: string;
          producer: string | null;
          base_unit: string;
          product_id: string;
          serving_quantity: number | null;
          note: string | null;
        }
      >,
      'many'
    >;
  },
  'strip',
  z.ZodTypeAny,
  {
    image: string | null;
    id: string;
    name: string;
    nutrients: Record<string, number>;
    servings: {
      serving: string | null;
      amount: number;
      name: string;
      producer: string | null;
      base_unit: string;
      product_id: string;
      serving_quantity: number | null;
      note: string | null;
    }[];
    portion_count: number;
    yazio_id: string | null;
    locale: string;
    instructions: string[];
    is_yazio_recipe: boolean;
    available_since: string | null;
    is_pro_recipe: boolean;
  },
  {
    image: string | null;
    id: string;
    name: string;
    nutrients: Record<string, number>;
    servings: {
      serving: string | null;
      amount: number;
      name: string;
      producer: string | null;
      base_unit: string;
      product_id: string;
      serving_quantity: number | null;
      note: string | null;
    }[];
    portion_count: number;
    yazio_id: string | null;
    locale: string;
    instructions: string[];
    is_yazio_recipe: boolean;
    available_since: string | null;
    is_pro_recipe: boolean;
  }
>;
type Recipe = z.infer<typeof RecipeSchema>;
/**
 * Get the list of recipe IDs belonging to the user (no details).
 * Use getRecipe(id) for each id to fetch full recipe data.
 *
 * @param token - The token to use for authentication.
 *
 * @returns - Promise resolving to an array of recipe UUIDs.
 */
declare const getUserRecipeIds: (token: Token) => Promise<string[]>;
/**
 * Get a recipe by id.
 *
 * @param token - The token to use for authentication.
 * @param recipeId - The UUID of the recipe.
 *
 * @returns - Promise resolving to the recipe.
 */
declare const getRecipe: (token: Token, recipeId: string) => Promise<Recipe>;
/**
 * Delete a user recipe by id.
 *
 * @param token - The token to use for authentication.
 * @param recipeId - The UUID of the recipe to delete.
 *
 * @returns - Promise resolving when the recipe was deleted (204).
 */
declare const deleteUserRecipe: (
  token: Token,
  recipeId: string,
) => Promise<void>;

declare const UserSchema: z.ZodObject<
  {
    diet: z.ZodNullable<
      z.ZodObject<
        {
          carb_percentage: z.ZodNumber;
          fat_percentage: z.ZodNumber;
          protein_percentage: z.ZodNumber;
          name: z.ZodString;
        },
        'strip',
        z.ZodTypeAny,
        {
          name: string;
          carb_percentage: number;
          fat_percentage: number;
          protein_percentage: number;
        },
        {
          name: string;
          carb_percentage: number;
          fat_percentage: number;
          protein_percentage: number;
        }
      >
    >;
    email: z.ZodString;
    premium_type: z.ZodString;
    sex: z.ZodEnum<['male', 'female', 'other']>;
    first_name: z.ZodString;
    last_name: z.ZodString;
    city: z.ZodString;
    country: z.ZodString;
    weight_change_per_week: z.ZodNumber;
    body_height: z.ZodNumber;
    goal: z.ZodString;
    date_of_birth: z.ZodString;
    registration_date: z.ZodString;
    timezone_offset: z.ZodNumber;
    unit_length: z.ZodString;
    unit_mass: z.ZodString;
    unit_glucose: z.ZodString;
    unit_serving: z.ZodString;
    unit_energy: z.ZodString;
    food_database_country: z.ZodString;
    profile_image: z.ZodString;
    user_token: z.ZodString;
    start_weight: z.ZodNumber;
    email_confirmation_status: z.ZodEnum<['confirmed', 'unconfirmed']>;
    newsletter_opt_in: z.ZodBoolean;
    login_type: z.ZodString;
    siwa_user_id: z.ZodNullable<z.ZodString>;
    uuid: z.ZodString;
    reset_date: z.ZodNullable<z.ZodString>;
    activity_degree: z.ZodString;
    stripe_customer_id: z.ZodNullable<z.ZodString>;
  },
  'strip',
  z.ZodTypeAny,
  {
    sex: 'male' | 'female' | 'other';
    unit_mass: string;
    unit_energy: string;
    unit_serving: string;
    unit_length: string;
    start_weight: number;
    goal: string;
    diet: {
      name: string;
      carb_percentage: number;
      fat_percentage: number;
      protein_percentage: number;
    } | null;
    email: string;
    premium_type: string;
    first_name: string;
    last_name: string;
    city: string;
    country: string;
    weight_change_per_week: number;
    body_height: number;
    date_of_birth: string;
    registration_date: string;
    timezone_offset: number;
    unit_glucose: string;
    food_database_country: string;
    profile_image: string;
    user_token: string;
    email_confirmation_status: 'confirmed' | 'unconfirmed';
    newsletter_opt_in: boolean;
    login_type: string;
    siwa_user_id: string | null;
    uuid: string;
    reset_date: string | null;
    activity_degree: string;
    stripe_customer_id: string | null;
  },
  {
    sex: 'male' | 'female' | 'other';
    unit_mass: string;
    unit_energy: string;
    unit_serving: string;
    unit_length: string;
    start_weight: number;
    goal: string;
    diet: {
      name: string;
      carb_percentage: number;
      fat_percentage: number;
      protein_percentage: number;
    } | null;
    email: string;
    premium_type: string;
    first_name: string;
    last_name: string;
    city: string;
    country: string;
    weight_change_per_week: number;
    body_height: number;
    date_of_birth: string;
    registration_date: string;
    timezone_offset: number;
    unit_glucose: string;
    food_database_country: string;
    profile_image: string;
    user_token: string;
    email_confirmation_status: 'confirmed' | 'unconfirmed';
    newsletter_opt_in: boolean;
    login_type: string;
    siwa_user_id: string | null;
    uuid: string;
    reset_date: string | null;
    activity_degree: string;
    stripe_customer_id: string | null;
  }
>;
type User$1 = z.infer<typeof UserSchema>;
/**
 * Get the user details.
 *
 * @param token - The token to use for authentication.
 *
 * @returns - Promise resolving to the user details.
 */
declare const getUser: (token: Token) => Promise<User$1>;

declare const GetUserMealImagesOptionsSchema: z.ZodObject<
  {
    date: z.ZodOptional<z.ZodUnion<[z.ZodDate, z.ZodString]>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    date?: string | Date | undefined;
  },
  {
    date?: string | Date | undefined;
  }
>;
type GetUserMealImagesOptions = z.infer<typeof GetUserMealImagesOptionsSchema>;
/** One photo URL per meal slot; an empty day returns {}. */
declare const UserMealImagesSchema: z.ZodRecord<
  z.ZodEnum<['breakfast', 'lunch', 'dinner', 'snack']>,
  z.ZodString
>;
type UserMealImages = z.infer<typeof UserMealImagesSchema>;
/**
 * Get diary photo URLs for a date (defaults to today).
 * Photos are grouped by meal slot, not by consumed-item ID.
 */
declare const getUserMealImages: (
  token: Token,
  options?: GetUserMealImagesOptions,
) => Promise<UserMealImages>;

declare class Products {
  private auth;
  constructor(auth: YazioAuth);
  get: (id: Parameters<typeof getProduct>[1]) => Promise<{
    id: string;
    name: string;
    is_verified: boolean;
    is_private: boolean;
    is_deleted: boolean;
    has_ean: boolean;
    category: string;
    producer: string | null;
    nutrients: {
      'energy.energy': number;
      'mineral.calcium': number;
      'mineral.chlorine': number;
      'mineral.copper': number;
      'mineral.fluorine': number;
      'mineral.iron': number;
      'mineral.magnesium': number;
      'mineral.manganese': number;
      'mineral.phosphorus': number;
      'mineral.potassium': number;
      'mineral.sulfur': number;
      'mineral.zinc': number;
      'nutrient.carb': number;
      'nutrient.dietaryfiber': number;
      'nutrient.fat': number;
      'nutrient.protein': number;
      'nutrient.sugar': number;
      'vitamin.a': number;
      'vitamin.b1': number;
      'vitamin.b12': number;
      'vitamin.b2': number;
      'vitamin.b6': number;
      'vitamin.d': number;
      'vitamin.e': number;
    };
    updated_at: string;
    servings: {
      serving: string;
      amount: number;
    }[];
    base_unit: string;
    eans: string[];
    language: string;
    countries: string[];
  } | null>;
  search: (options: Parameters<typeof searchProducts>[1]) => Promise<
    {
      serving: string;
      amount: number;
      name: string;
      is_verified: boolean;
      producer: string;
      nutrients: {
        'energy.energy': number;
        'nutrient.carb': number;
        'nutrient.fat': number;
        'nutrient.protein': number;
      };
      base_unit: string;
      language: string;
      countries: string[];
      score: number;
      product_id: string;
      serving_quantity: number;
    }[]
  >;
}
declare class User {
  private auth;
  constructor(auth: YazioAuth);
  get: () => Promise<{
    sex: 'male' | 'female' | 'other';
    unit_mass: string;
    unit_energy: string;
    unit_serving: string;
    unit_length: string;
    start_weight: number;
    goal: string;
    diet: {
      name: string;
      carb_percentage: number;
      fat_percentage: number;
      protein_percentage: number;
    } | null;
    email: string;
    premium_type: string;
    first_name: string;
    last_name: string;
    city: string;
    country: string;
    weight_change_per_week: number;
    body_height: number;
    date_of_birth: string;
    registration_date: string;
    timezone_offset: number;
    unit_glucose: string;
    food_database_country: string;
    profile_image: string;
    user_token: string;
    email_confirmation_status: 'confirmed' | 'unconfirmed';
    newsletter_opt_in: boolean;
    login_type: string;
    siwa_user_id: string | null;
    uuid: string;
    reset_date: string | null;
    activity_degree: string;
    stripe_customer_id: string | null;
  }>;
  getWeight: (options?: Parameters<typeof getUserWeight>[1]) => Promise<{
    value: number | null;
    date: string;
    id: string;
    external_id: string | null;
    gateway: string | null;
    source: string | null;
  } | null>;
  getSuggestedProducts: (
    options: Parameters<typeof getUserSuggestedProducts>[1],
  ) => Promise<
    {
      serving: string | null;
      amount: number;
      product_id: string;
      serving_quantity: number | null;
    }[]
  >;
  getDietaryPreferences: () => Promise<{
    restriction: string | null;
  }>;
  getExercises: (options?: Parameters<typeof getUserExercises>[1]) => Promise<{
    training: Array<Exercise>;
    custom_training: Array<Exercise>;
  }>;
  getGoals: (options?: Parameters<typeof getUserGoals>[1]) => Promise<{
    'energy.energy': number;
    'nutrient.carb': number;
    'nutrient.fat': number;
    'nutrient.protein': number;
    'activity.step': number;
    'bodyvalue.weight': number;
    water: number;
  }>;
  getSettings: () => Promise<{
    has_water_tracker: boolean;
    has_diary_tipps: boolean;
    has_meal_reminders: boolean;
    has_usage_reminders: boolean;
    has_weight_reminders: boolean;
    has_water_reminders: boolean;
    consume_activity_calories: boolean;
    has_feelings: boolean;
    has_fasting_tracker_reminders: boolean;
    has_fasting_stage_reminders: boolean;
  }>;
  getWaterIntake: (
    options?: Parameters<typeof getUserWaterIntake>[1],
  ) => Promise<{
    gateway: string | null;
    source: string | null;
    water_intake: number;
  }>;
  getDailySummary: (
    options?: Parameters<typeof getUserDailySummary>[1],
  ) => Promise<{
    steps: number;
    activity_energy: number;
    consume_activity_energy: boolean;
    water_intake: number;
    goals: {
      'energy.energy': number;
      'nutrient.carb': number;
      'nutrient.fat': number;
      'nutrient.protein': number;
      'activity.step': number;
      'bodyvalue.weight': number;
      water: number;
    };
    units: {
      unit_mass: string;
      unit_energy: string;
      unit_serving: string;
      unit_length: string;
    };
    meals: {
      breakfast: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      lunch: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      dinner: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
      snack: {
        nutrients: {
          'energy.energy': number;
          'nutrient.carb': number;
          'nutrient.fat': number;
          'nutrient.protein': number;
        };
        energy_goal: number;
      };
    };
    user: {
      sex?: string | undefined;
      start_weight?: number | undefined;
      current_weight?: number | undefined;
      goal?: string | undefined;
    };
    active_fasting_countdown_template_key: string | null;
  }>;
  getConsumedItems: (
    options?: Parameters<typeof getUserConsumedItems>[1],
  ) => Promise<{
    products: {
      type: string;
      date: string;
      serving: string | null;
      amount: number;
      id: string;
      product_id: string;
      serving_quantity: number | null;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    }[];
    recipe_portions: {
      type: 'recipe_portion';
      date: string;
      id: string;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      recipe_id: string;
      portion_count: number;
    }[];
    simple_products: {
      type: 'simple_product';
      date: string;
      id: string;
      name: string;
      nutrients: Record<string, number>;
      daytime: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      is_ai_generated: boolean;
    }[];
  }>;
  getMealImages: (
    options?: Parameters<typeof getUserMealImages>[1],
  ) => Promise<
    Partial<Record<'breakfast' | 'lunch' | 'dinner' | 'snack', string>>
  >;
  addConsumedItem: (
    options: Parameters<typeof addUserConsumedItem>[1],
  ) => Promise<void>;
  removeConsumedItem: (
    options: Parameters<typeof removeUserConsumedItem>[1],
  ) => Promise<void>;
  getRecipe: (id: Parameters<typeof getRecipe>[1]) => Promise<{
    image: string | null;
    id: string;
    name: string;
    nutrients: Record<string, number>;
    servings: {
      serving: string | null;
      amount: number;
      name: string;
      producer: string | null;
      base_unit: string;
      product_id: string;
      serving_quantity: number | null;
      note: string | null;
    }[];
    portion_count: number;
    yazio_id: string | null;
    locale: string;
    instructions: string[];
    is_yazio_recipe: boolean;
    available_since: string | null;
    is_pro_recipe: boolean;
  }>;
  getRecipeIds: () => Promise<string[]>;
  deleteRecipe: (id: Parameters<typeof deleteUserRecipe>[1]) => Promise<void>;
}
declare class Yazio {
  private auth;
  products: Products;
  user: User;
  /**
   * Create a new YAZIO API client.
   *
   * @param auth - The authentication details. Either in the form of an object
   * containing a previously obtained token pair or account credentials, or an
   * instance of `YazioAuth`.
   */
  constructor(auth: YazioAuth | YazioAuthInit);
}

/**
 * Utility function to automatically fetch from the given base URL. If an
 * explicit URL is provided (string starting with `http`), it will be used.
 *
 * @param input - The URL or endpoint to fetch from.
 * @param init - The fetch options.
 *
 * @returns - Promise resolving the JSON data of the response body.
 */
declare const fetchYazio: <T>(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
) => Promise<T>;

export {
  type Credentials,
  type CredentialsResolver,
  CredentialsResolverSchema,
  CredentialsSchema,
  type GetUserMealImagesOptions,
  GetUserMealImagesOptionsSchema,
  type RefreshHandler,
  RefreshHandlerSchema,
  type Token,
  type TokenResolver,
  TokenResolverSchema,
  TokenSchema,
  type UserMealImages,
  UserMealImagesSchema,
  Yazio,
  YazioAuth,
  type YazioAuthInit,
  YazioAuthInitSchema,
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
