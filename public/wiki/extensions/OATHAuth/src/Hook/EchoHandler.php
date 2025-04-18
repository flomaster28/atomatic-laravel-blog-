<?php

namespace MediaWiki\Extension\OATHAuth\Hook;

use MediaWiki\Extension\Notifications\AttributeManager;
use MediaWiki\Extension\Notifications\Hooks\BeforeCreateEchoEventHook;
use MediaWiki\Extension\Notifications\UserLocator;
use MediaWiki\Extension\OATHAuth\Notifications\DisablePresentationModel;
use MediaWiki\Extension\OATHAuth\Notifications\EnablePresentationModel;
use MediaWiki\Extension\OATHAuth\Notifications\RecoveryCodeCountPresentationModel;

/**
 * Hooks from Echo extension,
 * which is optional to use with this extension.
 */
class EchoHandler implements BeforeCreateEchoEventHook {

	/**
	 * Hook: BeforeCreateEchoEvent
	 *
	 * Configure our notification types. We don't register a category since
	 * these are all "system" messages that cannot be disabled.
	 *
	 * @param array &$notifications
	 * @param array &$notificationCategories
	 * @param array &$notificationIcons
	 */
	public function onBeforeCreateEchoEvent(
		array &$notifications, array &$notificationCategories, array &$notificationIcons
	) {
		// message used: notification-header-oathauth-disable
		$notifications['oathauth-disable'] = [
			'category' => 'system',
			'group' => 'negative',
			'section' => 'alert',
			'presentation-model' => DisablePresentationModel::class,
			'canNotifyAgent' => true,
			AttributeManager::ATTR_LOCATORS => [
				[ [ UserLocator::class, 'locateEventAgent' ] ],
			],
		];

		// message used: notification-header-oathauth-enable
		$notifications['oathauth-enable'] = [
			'category' => 'system',
			'group' => 'positive',
			'section' => 'alert',
			'presentation-model' => EnablePresentationModel::class,
			'canNotifyAgent' => true,
			AttributeManager::ATTR_LOCATORS => [
				[ [ UserLocator::class, 'locateEventAgent' ] ],
			],
		];

		// message used: notification-header-oathauth-recoverycodes-count
		$notifications['oathauth-recoverycodes-count'] = [
			'category' => 'system',
			'group' => 'negative',
			'section' => 'alert',
			'presentation-model' => RecoveryCodeCountPresentationModel::class,
			'canNotifyAgent' => true,
			'user-locators' => [ 'EchoUserLocator::locateEventAgent' ],
		];
	}
}
