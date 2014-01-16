<!DOCTYPE html>
<html lang="en" ng-app>
<head>
	<title>Admin | Wardrobe</title>
	<meta name="env" content="<?php echo App::environment() ?>">
	<meta name="token" content="<?php echo Session::token() ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" type="text/css" href="<?php echo asset('admin/style.css') ?>">
</head>
<body ng-controller="PostsController">
<div id="header-region"></div>
<div id="js-alert"></div>
<div class="container-fluid">
	<div class="row-fluid">
		<ul>
			<li ng-repeat="post in posts">
				{{ post.title }}
			</li>
		</ul>
		<div id="main-region">HOME</div>
		<div>Angular seed app: v<span app-version></span></div>
	</div>
</div>
<script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
<script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.2.5/angular.js"></script>
<script src="<?php echo asset('packages/wardrobe/cabinet/js/main.js') ?>"></script>
</body>
</html>
