// Minova Cinema Shadow Detail - Low
// Lifts only the lower portion of the luma curve while preserving true black,
// chroma, midtones, and highlights.

//!DESC Minova Shadow Detail Low
//!HOOK MAIN
//!BIND HOOKED

vec4 hook() {
    vec4 color = HOOKED_tex(HOOKED_pos);
    vec3 rgb = max(color.rgb, vec3(0.0));
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float black_guard = smoothstep(0.003, 0.025, luma);
    float shadow_band = 1.0 - smoothstep(0.18, 0.45, luma);
    float lifted_luma = min(luma + 0.018 * black_guard * shadow_band, 1.0);
    rgb *= lifted_luma / max(luma, 0.0001);
    return vec4(min(rgb, vec3(1.0)), color.a);
}
