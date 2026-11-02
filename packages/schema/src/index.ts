// 원본 스키마 파일은 제공받은 그대로 유지해야 하므로, 패키지 진입점만 여기서 따로 둔다.
// 빌드 없이 TS 소스를 직접 export한다. 소비자(server는 tsx, web은 transpilePackages)가 각자 트랜스파일한다.
export * from "./agent-adapter-schema";
export * from "./protocol";
