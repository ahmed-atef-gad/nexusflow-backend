import { EventType } from './enum/pigeon.eventtype.enum'; 
import { MqttSubscribeOptions } from './pigeon.interface';
import { validateTopic } from './pigeon.validator'; 

export class PigeonTopicCreator {
   
    static match(pattern: any, topic: string): any {
       
        const matches = pattern.match(/:[^/]+/g);
        if (!matches) return []; // Fix: Check for null
        const keys = matches.map((key) => key.slice(1));
        // ...
        return null; // Fix: Return null at the end if needed (or check explicit return types)
    }
}
