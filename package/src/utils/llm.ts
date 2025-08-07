import {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {initChatModel} from 'langchain/chat_models/universal';

export async function getModel(modelName?: string): Promise<BaseChatModel> {
	if (!modelName) {
		modelName = 'openai:gpt-4o-mini';
	}
	const modelNameString = modelName.toString();
	const model = await initChatModel(modelNameString, {
		// temperature: 0.7,
	});
	return model;
}

export async function callModel(
	ctxWindow: string,
	systemMessage: string,
	modelName?: string,
	stream: boolean = false,
): Promise<any> {
	// eslint-disable-line @typescript-eslint/no-explicit-any
	const messages = [
		{role: 'system', content: systemMessage},
		{role: 'user', content: ctxWindow},
	];

	const model = await getModel(modelName);
	if (stream) {
		return model.stream(messages);
	} else {
		return model.invoke(messages);
	}
}
