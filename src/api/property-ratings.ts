/**
 * Hand-written React Query wrappers for the property-rating endpoints.
 * The generated client doesn't cover these (no checked-in OpenAPI spec to
 * regenerate against), so we follow the same `customFetch` + orval-shaped
 * pattern the generated client uses.
 */
import {
  useMutation,
  type MutationFunction,
  type UseMutationOptions,
} from "@tanstack/react-query";
import {
  customFetch,
  ErrorType,
  type AuthTokenGetter,
  setAuthTokenGetter,
  setBaseUrl,
} from "./custom-fetch";
import type { PropertyRatingDetail } from "./generated/api.schemas";

// Mirrors the generated client's local alias so our hook signatures line up.
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

export const getCreatePropertyRatingUrl = (propertyId: string) =>
  `/api/properties/${propertyId}/ratings`;

export const createPropertyRating = async (
  propertyId: string,
  input: { booking_id: string; stars: number; review_text?: string },
  options?: RequestInit,
): Promise<PropertyRatingDetail> =>
  customFetch<PropertyRatingDetail>(getCreatePropertyRatingUrl(propertyId), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(input),
  });

export const getCreatePropertyRatingMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createPropertyRating>>,
    TError,
    { propertyId: string; data: { booking_id: string; stars: number; review_text?: string } },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const mutationKey = ["createPropertyRating"] as const;
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createPropertyRating>>,
    { propertyId: string; data: { booking_id: string; stars: number; review_text?: string } }
  > = (props) => {
    return createPropertyRating(props.propertyId, props.data, requestOptions);
  };

  return {
    ...mutationOptions,
    mutationFn,
    mutationKey,
  } as UseMutationOptions<
    Awaited<ReturnType<typeof createPropertyRating>>,
    TError,
    { propertyId: string; data: { booking_id: string; stars: number; review_text?: string } },
    TContext
  >;
};

export const useCreatePropertyRating = (options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createPropertyRating>>,
    ErrorType<unknown>,
    { propertyId: string; data: { booking_id: string; stars: number; review_text?: string } }
  >;
  request?: SecondParameter<typeof customFetch>;
}) => useMutation(getCreatePropertyRatingMutationOptions(options));

// Re-exports so call sites can `import { ... } from "@/api"` and stay consistent
// with the generated client surface.
export { setBaseUrl, setAuthTokenGetter };
export type { AuthTokenGetter };
