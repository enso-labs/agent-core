import YAML from 'yaml';

export const jsonToYaml = (json: any) => {
	return YAML.stringify(json);
};

export const yamlToJson = (yaml: string) => {
	return YAML.parse(yaml);
};
